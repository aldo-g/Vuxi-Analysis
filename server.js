const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

// Capture pipeline modules (merged from vuxi-capture)
const { URLDiscoveryService } = require('./url-discovery');
const { EnhancedScreenshotService } = require('./screenshot/enhanced-integration');

// Analysis pipeline modules
const { analysis } = require('./index');

const app = express();
const PORT = process.env.PIPELINE_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Job state ────────────────────────────────────────────────────────────────

const jobs = new Map();

// Unified status covering both capture and analysis phases
const JOB_STATUS = {
  PENDING:            'pending',
  RUNNING:            'running',
  URL_DISCOVERY:      'url_discovery',
  SCREENSHOT_CAPTURE: 'screenshot_capture',
  LIGHTHOUSE:         'lighthouse',
  LLM_ANALYSIS:       'llm_analysis',
  FORMATTING:         'formatting',
  REPORT_GENERATION:  'report_generation',
  COMPLETED:          'completed',
  FAILED:             'failed',
};

async function persistJob(job) {
  // Store lightweight status only — no large intermediate results
  const { error } = await supabase
    .from('AnalysisJob')
    .upsert({
      id: job.id,
      captureJobId: job.id, // same job, no separate capture job
      status: job.status,
      progress: job.progress || null,
      analysisData: job.analysisData || null,
      results: null,
      error: job.error || null,
      updatedAt: new Date().toISOString(),
    }, { onConflict: 'id' });
  if (error) console.error(`DB persist error for job ${job.id.slice(0, 8)}:`, error.message);
}

async function loadJob(jobId) {
  const { data, error } = await supabase
    .from('AnalysisJob')
    .select('*')
    .eq('id', jobId)
    .single();
  if (error || !data) return null;
  const job = {
    id: data.id,
    status: data.status,
    progress: data.progress,
    analysisData: data.analysisData,
    results: data.results,
    error: data.error,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
  jobs.set(jobId, job);
  return job;
}

const PERSIST_STATUSES = new Set([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
]);

function updateJobStatus(jobId, status, updates = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = new Date().toISOString();
  Object.assign(job, updates);
  console.log(`📊 Job ${jobId.slice(0, 8)}: ${status} — ${updates.progress?.message || ''}`);
  if (PERSIST_STATUSES.has(status)) persistJob(job);
}

// ─── Error classification ─────────────────────────────────────────────────────

function classifyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('403') || m.includes('forbidden') || m.includes('captcha') || m.includes('cloudflare') || m.includes('bot')) return 'bot_protection';
  if (m.includes('enotfound') || m.includes('getaddrinfo') || m.includes('dns')) return 'dns_error';
  if (m.includes('econnrefused') || m.includes('502') || m.includes('503') || m.includes('504')) return 'connection_error';
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
  if (m.includes('no urls discovered')) return 'no_urls';
  return 'unknown';
}

// ─── Supabase Storage upload ──────────────────────────────────────────────────

async function uploadScreenshotsToSupabase(jobId, successful) {
  console.log(`☁️  Uploading ${successful.length} screenshots to Supabase...`);
  const results = [];

  for (const entry of successful) {
    const storagePath = `job_${jobId}/${entry.filename}`;
    try {
      const fileBuffer = entry.buffer || await fs.readFile(entry.outputPath);
      const { error } = await supabase.storage
        .from('screenshots')
        .upload(storagePath, fileBuffer, { contentType: 'image/png', upsert: true });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('screenshots')
        .getPublicUrl(storagePath);

      results.push({ ...entry, storageUrl: publicUrl });
      console.log(`☁️  Uploaded ${entry.filename}`);
    } catch (err) {
      console.error(`☁️  Failed to upload ${entry.filename}:`, err.message);
      results.push({ ...entry, storageUrl: null });
    }

    // Upload interaction screenshots too
    for (const interaction of (entry.interactions || [])) {
      if (interaction.status !== 'captured' || !interaction.path) continue;
      const absPath = path.join(path.dirname(entry.outputPath), path.basename(interaction.path));
      const interactionStoragePath = `job_${jobId}/${path.basename(interaction.path)}`;
      try {
        const buf = await fs.readFile(absPath);
        const { error } = await supabase.storage
          .from('screenshots')
          .upload(interactionStoragePath, buf, { contentType: 'image/png', upsert: true });
        if (!error) {
          const { data: { publicUrl } } = supabase.storage
            .from('screenshots')
            .getPublicUrl(interactionStoragePath);
          interaction.storageUrl = publicUrl;
        }
      } catch (err) {
        console.error(`☁️  Failed to upload interaction screenshot:`, err.message);
      }
    }
  }

  console.log(`☁️  Upload complete: ${results.filter(r => r.storageUrl).length}/${results.length} succeeded`);
  return results;
}

// ─── Download helper (for remote storageUrls) ─────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = require('fs').createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.remove(destPath).catch(() => {});
        return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => { fs.remove(destPath).catch(() => {}); reject(err); });
    }).on('error', (err) => { fs.remove(destPath).catch(() => {}); reject(err); });
  });
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');

  const { analysisData } = job;
  const outputDir = path.join(__dirname, 'data', `job_${jobId}`);
  const desktopDir = path.join(outputDir, 'desktop');

  await fs.ensureDir(desktopDir);

  // ── Phase 1: URL Discovery ──────────────────────────────────────────────────

  updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
    progress: { stage: 'url_discovery', percentage: 10, message: 'Discovering URLs...' }
  });

  const urlService = new URLDiscoveryService({
    maxPages: analysisData.options?.maxPages || 20,
    timeout: analysisData.options?.timeout || 8000,
    concurrency: analysisData.options?.concurrency || 3,
    fastMode: analysisData.options?.fastMode !== false,
    outputDir,
  });

  const urlResult = await Promise.race([
    urlService.discover(analysisData.websiteUrl),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('URL discovery timeout after 2 minutes')), 120000)
    ),
  ]);

  if (!urlResult.success || !urlResult.urls?.length) {
    const err = new Error(urlResult.error || 'No URLs discovered from the website');
    err.errorType = classifyError(err.message);
    throw err;
  }

  console.log(`✅ URL discovery: ${urlResult.urls.length} URLs found`);

  updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
    progress: { stage: 'url_discovery_complete', percentage: 25, message: `Found ${urlResult.urls.length} URLs` },
    urlDiscovery: { urls: urlResult.urls, stats: urlResult.stats },
  });

  // ── Phase 2: Screenshot Capture ────────────────────────────────────────────

  updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
    progress: { stage: 'screenshot_capture', percentage: 30, message: `Capturing screenshots for ${urlResult.urls.length} URLs...` }
  });

  const screenshotService = new EnhancedScreenshotService({
    outputDir,
    concurrent: analysisData.options?.concurrency || 4,
    timeout: analysisData.options?.timeout || 30000,
    viewport: { width: 1440, height: 900 },
    enableInteractiveCapture: analysisData.options?.captureInteractive !== false,
    maxInteractions: analysisData.options?.maxInteractions || 30,
    maxScreenshotsPerPage: analysisData.options?.maxScreenshotsPerPage || 15,
    interactionDelay: analysisData.options?.interactionDelay || 800,
    changeDetectionTimeout: analysisData.options?.changeDetectionTimeout || 2000,
    maxInteractionsPerType: analysisData.options?.maxInteractionsPerType || 3,
    prioritizeNavigation: analysisData.options?.prioritizeNavigation !== false,
    skipSocialElements: analysisData.options?.skipSocialElements !== false,
  });

  const screenshotResult = await screenshotService.captureAll(urlResult.urls);

  if (!screenshotResult.success && (screenshotResult.successful?.length ?? 0) === 0) {
    const err = new Error(`Screenshot capture failed: ${screenshotResult.error || 'all pages failed to load'}`);
    err.errorType = classifyError(err.message);
    throw err;
  }

  console.log(`✅ Screenshots: ${screenshotResult.successful?.length || 0} captured`);

  // Upload screenshots to Supabase Storage
  const screenshotsWithUrls = await uploadScreenshotsToSupabase(jobId, screenshotResult.successful || []);

  // Build the screenshots array in the shape the analysis pipeline expects
  const screenshots = screenshotsWithUrls.map(entry => ({
    url: entry.url,
    success: true,
    data: {
      filename: entry.filename,
      path: `desktop/${entry.filename}`,
      storageUrl: entry.storageUrl || null,
      outputPath: entry.outputPath,
    },
  }));

  // Persist screenshot results onto the job so polling clients can see them
  updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
    progress: { stage: 'screenshot_capture_complete', percentage: 45, message: `${screenshots.length} screenshots ready` },
    captureResults: {
      urls: urlResult.urls,
      screenshots,
      stats: screenshotResult.stats,
    },
  });

  // ── Phase 3: Analysis ──────────────────────────────────────────────────────

  // Derive unique page URLs from screenshots
  const urls = [...new Set(screenshots.map(s => s.url).filter(u => u?.startsWith('http')))];
  if (!urls.length) urls.push(analysisData.websiteUrl);

  const analysisInput = {
    urls,
    organizationName: analysisData.organizationName,
    organizationType: 'organization',
    organizationPurpose: analysisData.primaryGoal || analysisData.sitePurpose,
    targetAudience: analysisData.targetAudience || '',
    primaryGoal: analysisData.primaryGoal || '',
    industry: analysisData.industry || '',
    captureJobId: jobId,          // analysis reads screenshots from data/job_{captureJobId}/desktop/
    screenshotsDir: desktopDir,   // explicit path, no cross-service resolution needed
  };

  const stageStatusMap = {
    lighthouse:         JOB_STATUS.LIGHTHOUSE,
    llm_analysis:       JOB_STATUS.LLM_ANALYSIS,
    formatting:         JOB_STATUS.FORMATTING,
    report_generation:  JOB_STATUS.REPORT_GENERATION,
  };

  const onProgress = (stage, percentage, message) => {
    updateJobStatus(jobId, stageStatusMap[stage] || JOB_STATUS.RUNNING, {
      progress: { stage, percentage, message },
    });
  };

  const result = await analysis(analysisInput, onProgress);

  if (!result.success) {
    throw new Error(result.error || 'Analysis failed');
  }

  updateJobStatus(jobId, JOB_STATUS.COMPLETED, {
    results: {
      captureJobId: jobId,
      urls,
      screenshots,
      reportData: result.reportData,
      lighthouse: result.lighthouse,
      llmAnalysis: result.llmAnalysis,
      formatting: result.formatting,
      htmlReport: result.htmlReport,
    },
    progress: { stage: 'completed', percentage: 100, message: `Analysis complete for ${urls.length} page${urls.length === 1 ? '' : 's'}` },
  });

  console.log(`✅ Job ${jobId.slice(0, 8)} completed`);
}

// ─── API routes ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const active = Array.from(jobs.values()).filter(j =>
    ![JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.PENDING].includes(j.status)
  ).length;
  res.json({ status: 'ok', service: 'vuxi-pipeline', activeJobs: active, timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Vuxi Pipeline Service',
    version: '2.0.0',
    description: 'Unified capture + analysis pipeline',
    endpoints: {
      health: 'GET /health',
      startJob: 'POST /api/pipeline',
      getJob: 'GET /api/pipeline/:jobId',
      // Legacy aliases kept for frontend compatibility
      startCapture: 'POST /api/capture',
      getCapture: 'GET /api/capture/:jobId',
      startAnalysis: 'POST /api/analysis',
      getAnalysis: 'GET /api/analysis/:jobId',
    },
  });
});

// POST /api/pipeline — primary endpoint
app.post('/api/pipeline', async (req, res) => {
  try {
    const { analysisData } = req.body;

    if (!analysisData?.websiteUrl) {
      return res.status(400).json({ error: 'analysisData.websiteUrl is required' });
    }
    if (!analysisData?.organizationName) {
      return res.status(400).json({ error: 'analysisData.organizationName is required' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const jobId = uuidv4();
    const job = {
      id: jobId,
      status: JOB_STATUS.PENDING,
      analysisData,
      progress: { stage: 'initializing', percentage: 0, message: 'Starting pipeline...' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    jobs.set(jobId, job);
    await persistJob(job);

    console.log(`🚀 Job ${jobId.slice(0, 8)} created for ${analysisData.websiteUrl}`);

    setImmediate(() => {
      updateJobStatus(jobId, JOB_STATUS.RUNNING, {
        progress: { stage: 'starting', percentage: 5, message: 'Starting pipeline...' },
      });
      processJob(jobId).catch(err => {
        console.error(`❌ Job ${jobId.slice(0, 8)} failed:`, err.message);
        updateJobStatus(jobId, JOB_STATUS.FAILED, {
          error: err.message,
          errorType: err.errorType || classifyError(err.message),
          progress: { stage: 'failed', percentage: 0, message: `Job failed: ${err.message}` },
        });
      });
    });

    res.json({ success: true, jobId, status: JOB_STATUS.PENDING });
  } catch (err) {
    console.error('Failed to create job:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// GET /api/pipeline/:jobId
app.get('/api/pipeline/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId) || await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.urlDiscovery && { urlDiscovery: job.urlDiscovery }),
    ...(job.captureResults && { captureResults: job.captureResults }),
    ...(job.status === JOB_STATUS.COMPLETED && { results: job.results }),
    ...(job.status === JOB_STATUS.FAILED && { error: job.error, errorType: job.errorType }),
  });
});

// ─── Legacy compatibility aliases ─────────────────────────────────────────────
// The frontend currently calls POST /api/capture and POST /api/analysis separately.
// These shims bridge the old two-service flow to the new unified pipeline so the
// frontend keeps working without changes.

// POST /api/capture — starts the pipeline, returns captureJobId = jobId
app.post('/api/capture', async (req, res) => {
  const { baseUrl, options = {} } = req.body || {};
  if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required' });

  // Capture-only mode: run URL discovery + screenshots, stop before analysis.
  // The frontend polls for status=completed then calls /api/analysis separately.
  // We kick off the full pipeline but return early so the frontend can drive the flow.
  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: JOB_STATUS.PENDING,
    analysisData: { websiteUrl: baseUrl, options },
    progress: { stage: 'initializing', percentage: 0, message: 'Starting capture...' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _captureOnly: true,   // flag: stop after screenshots, wait for /api/analysis call
  };

  jobs.set(jobId, job);
  await persistJob(job);

  setImmediate(() => {
    updateJobStatus(jobId, JOB_STATUS.RUNNING, {
      progress: { stage: 'starting', percentage: 5, message: 'Starting capture...' },
    });
    runCapturePhase(jobId).catch(err => {
      console.error(`❌ Capture job ${jobId.slice(0, 8)} failed:`, err.message);
      updateJobStatus(jobId, JOB_STATUS.FAILED, {
        error: err.message,
        errorType: err.errorType || classifyError(err.message),
        progress: { stage: 'failed', percentage: 0, message: `Capture failed: ${err.message}` },
      });
    });
  });

  res.json({ jobId, status: JOB_STATUS.PENDING });
});

// GET /api/capture/:jobId
app.get('/api/capture/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId) || await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    baseUrl: job.analysisData?.websiteUrl,
    ...(job.urlDiscovery && { urlDiscovery: job.urlDiscovery }),
    ...(job.status === JOB_STATUS.COMPLETED && { results: job.captureResults }),
    ...(job.status === JOB_STATUS.FAILED && { error: job.error, errorType: job.errorType }),
  });
});

// POST /api/analysis — receives analysisData + captureJobId, runs analysis on already-captured screenshots
app.post('/api/analysis', async (req, res) => {
  try {
    const { analysisData, captureJobId } = req.body;

    if (!analysisData || !captureJobId) {
      return res.status(400).json({ error: 'Missing required fields: analysisData and captureJobId' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // If there's an existing capture job with this ID, attach analysis to it
    const captureJob = jobs.get(captureJobId);
    if (captureJob && captureJob._captureOnly) {
      // Upgrade the capture job to a full analysis job
      captureJob._captureOnly = false;
      captureJob.analysisData = { ...captureJob.analysisData, ...analysisData };
      jobs.set(captureJobId, captureJob);

      // Run analysis phase on the already-captured screenshots
      setImmediate(() => {
        runAnalysisPhase(captureJobId).catch(err => {
          console.error(`❌ Analysis phase ${captureJobId.slice(0, 8)} failed:`, err.message);
          updateJobStatus(captureJobId, JOB_STATUS.FAILED, {
            error: err.message,
            progress: { stage: 'failed', percentage: 0, message: `Analysis failed: ${err.message}` },
          });
        });
      });

      return res.json({ success: true, jobId: captureJobId, status: captureJob.status });
    }

    // No existing capture job — create a fresh job and run full pipeline
    const jobId = uuidv4();
    const job = {
      id: jobId,
      status: JOB_STATUS.PENDING,
      analysisData: { ...analysisData, captureJobId },
      progress: { stage: 'initializing', percentage: 0, message: 'Starting analysis...' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    jobs.set(jobId, job);
    await persistJob(job);

    setImmediate(() => {
      updateJobStatus(jobId, JOB_STATUS.RUNNING, {
        progress: { stage: 'starting', percentage: 5, message: 'Starting analysis...' },
      });
      processJob(jobId).catch(err => {
        console.error(`❌ Job ${jobId.slice(0, 8)} failed:`, err.message);
        updateJobStatus(jobId, JOB_STATUS.FAILED, {
          error: err.message,
          progress: { stage: 'failed', percentage: 0, message: `Analysis failed: ${err.message}` },
        });
      });
    });

    res.json({ success: true, jobId, status: JOB_STATUS.PENDING });
  } catch (err) {
    console.error('Failed to start analysis:', err);
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});

// GET /api/analysis/:jobId
app.get('/api/analysis/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId) || await loadJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === JOB_STATUS.COMPLETED && { results: job.results }),
    ...(job.status === JOB_STATUS.FAILED && { error: job.error }),
  });
});

// GET /api/jobs
app.get('/api/jobs', (req, res) => {
  res.json(Array.from(jobs.values()).map(j => ({
    id: j.id,
    status: j.status,
    websiteUrl: j.analysisData?.websiteUrl,
    createdAt: j.createdAt,
    progress: j.progress,
  })));
});

// Serve screenshots for the report viewer
app.use('/data', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(path.join(__dirname, 'data')));

// ─── Capture-only phase (used by legacy /api/capture flow) ───────────────────

async function runCapturePhase(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');

  const { analysisData } = job;
  const outputDir = path.join(__dirname, 'data', `job_${jobId}`);
  const desktopDir = path.join(outputDir, 'desktop');
  await fs.ensureDir(desktopDir);

  // URL Discovery
  updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
    progress: { stage: 'url_discovery', percentage: 10, message: 'Discovering URLs...' },
  });

  const urlService = new URLDiscoveryService({
    maxPages: analysisData.options?.maxPages || 20,
    timeout: analysisData.options?.timeout || 8000,
    concurrency: analysisData.options?.concurrency || 3,
    fastMode: analysisData.options?.fastMode !== false,
    outputDir,
  });

  const urlResult = await Promise.race([
    urlService.discover(analysisData.websiteUrl),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('URL discovery timeout after 2 minutes')), 120000)
    ),
  ]);

  if (!urlResult.success || !urlResult.urls?.length) {
    const err = new Error(urlResult.error || 'No URLs discovered');
    err.errorType = classifyError(err.message);
    throw err;
  }

  updateJobStatus(jobId, JOB_STATUS.URL_DISCOVERY, {
    progress: { stage: 'url_discovery_complete', percentage: 40, message: `Found ${urlResult.urls.length} URLs` },
    urlDiscovery: { urls: urlResult.urls, stats: urlResult.stats, originalUrlCount: urlResult.urls.length },
  });

  // Screenshot Capture
  updateJobStatus(jobId, JOB_STATUS.SCREENSHOT_CAPTURE, {
    progress: { stage: 'screenshot_capture', percentage: 50, message: `Capturing screenshots for ${urlResult.urls.length} URLs...` },
  });

  const screenshotService = new EnhancedScreenshotService({
    outputDir,
    concurrent: analysisData.options?.concurrency || 4,
    timeout: analysisData.options?.timeout || 30000,
    viewport: { width: 1440, height: 900 },
    enableInteractiveCapture: analysisData.options?.captureInteractive !== false,
    maxInteractions: analysisData.options?.maxInteractions || 30,
    maxScreenshotsPerPage: analysisData.options?.maxScreenshotsPerPage || 15,
    interactionDelay: analysisData.options?.interactionDelay || 800,
    changeDetectionTimeout: analysisData.options?.changeDetectionTimeout || 2000,
    maxInteractionsPerType: analysisData.options?.maxInteractionsPerType || 3,
    prioritizeNavigation: analysisData.options?.prioritizeNavigation !== false,
    skipSocialElements: analysisData.options?.skipSocialElements !== false,
  });

  const screenshotResult = await screenshotService.captureAll(urlResult.urls);

  if (!screenshotResult.success && (screenshotResult.successful?.length ?? 0) === 0) {
    const err = new Error(`Screenshot capture failed: ${screenshotResult.error || 'all pages failed'}`);
    err.errorType = classifyError(err.message);
    throw err;
  }

  const screenshotsWithUrls = await uploadScreenshotsToSupabase(jobId, screenshotResult.successful || []);

  const screenshots = screenshotsWithUrls.map(entry => ({
    url: entry.url,
    success: true,
    data: {
      filename: entry.filename,
      path: `desktop/${entry.filename}`,
      storageUrl: entry.storageUrl || null,
      outputPath: entry.outputPath,
    },
  }));

  updateJobStatus(jobId, JOB_STATUS.COMPLETED, {
    captureResults: { urls: urlResult.urls, screenshots, stats: screenshotResult.stats },
    progress: { stage: 'completed', percentage: 100, message: `Captured ${screenshots.length} screenshots` },
  });

  console.log(`✅ Capture phase complete for job ${jobId.slice(0, 8)}`);
}

// ─── Analysis-only phase (used by legacy /api/analysis flow after capture) ────

async function runAnalysisPhase(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');

  const { analysisData } = job;
  const screenshots = job.captureResults?.screenshots || analysisData.screenshots || [];
  const desktopDir = path.join(__dirname, 'data', `job_${jobId}`, 'desktop');

  // For any remote storageUrls not yet on disk, download them
  let existingCount = 0;
  try {
    const existing = await fs.readdir(desktopDir);
    existingCount = existing.filter(f => /\.(png|jpg|jpeg)$/i.test(f)).length;
  } catch (_) {}

  let customIndex = existingCount + 1;
  for (const screenshot of screenshots) {
    const storageUrl = screenshot.data?.storageUrl;
    if (!storageUrl?.startsWith('http')) continue;
    if (screenshot.data?.filename && await fs.pathExists(path.join(desktopDir, screenshot.data.filename))) continue;

    const pageUrl = screenshot.url;
    let localFilename;
    try {
      const urlObj = new URL(pageUrl);
      const host = urlObj.hostname.replace(/^www\./, '');
      const pathPart = urlObj.pathname.split('/').filter(Boolean).slice(0, 3).join('-').replace(/[^a-z0-9-]/gi, '-');
      const ext = path.extname(storageUrl.split('?')[0]) || '.png';
      localFilename = `${String(customIndex).padStart(3, '0')}_${host.replace(/[^a-z0-9.-]/gi, '-')}${pathPart ? `_${pathPart}` : ''}${ext}`;
    } catch (_) {
      localFilename = `${String(customIndex).padStart(3, '0')}_custom.png`;
    }

    const destPath = path.join(desktopDir, localFilename);
    try {
      await fs.ensureDir(desktopDir);
      await downloadFile(storageUrl, destPath);
      if (!screenshot.data) screenshot.data = {};
      screenshot.data.filename = localFilename;
      screenshot.data.path = `desktop/${localFilename}`;
    } catch (err) {
      console.warn(`⚠️  Could not download screenshot for ${pageUrl}: ${err.message}`);
    }
    customIndex++;
  }

  // Derive URLs
  const urls = [...new Set(screenshots.map(s => s.url).filter(u => u?.startsWith('http')))];
  if (!urls.length) urls.push(analysisData.websiteUrl);

  const analysisInput = {
    urls,
    organizationName: analysisData.organizationName,
    organizationType: 'organization',
    organizationPurpose: analysisData.primaryGoal || analysisData.sitePurpose,
    targetAudience: analysisData.targetAudience || '',
    primaryGoal: analysisData.primaryGoal || '',
    industry: analysisData.industry || '',
    captureJobId: jobId,
    screenshotsDir: desktopDir,
  };

  const stageStatusMap = {
    lighthouse: JOB_STATUS.LIGHTHOUSE,
    llm_analysis: JOB_STATUS.LLM_ANALYSIS,
    formatting: JOB_STATUS.FORMATTING,
    report_generation: JOB_STATUS.REPORT_GENERATION,
  };

  const onProgress = (stage, percentage, message) => {
    updateJobStatus(jobId, stageStatusMap[stage] || JOB_STATUS.RUNNING, {
      progress: { stage, percentage, message },
    });
  };

  const result = await analysis(analysisInput, onProgress);
  if (!result.success) throw new Error(result.error || 'Analysis failed');

  updateJobStatus(jobId, JOB_STATUS.COMPLETED, {
    results: {
      captureJobId: jobId,
      urls,
      screenshots,
      reportData: result.reportData,
      lighthouse: result.lighthouse,
      llmAnalysis: result.llmAnalysis,
      formatting: result.formatting,
      htmlReport: result.htmlReport,
    },
    progress: { stage: 'completed', percentage: 100, message: `Analysis complete for ${urls.length} page${urls.length === 1 ? '' : 's'}` },
  });

  console.log(`✅ Analysis phase complete for job ${jobId.slice(0, 8)}`);
}

// ─── Error handling ───────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Vuxi Pipeline Service running on port ${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY not set');
  }
  if (!process.env.SUPABASE_URL) {
    console.warn('⚠️  WARNING: SUPABASE_URL not set');
  }
});

module.exports = app;
