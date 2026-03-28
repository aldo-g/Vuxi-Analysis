const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');

// Load environment variables from root .env file
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.ANALYSIS_PORT || 3002;

// Import analysis function
const { analysis } = require('./index');

// Middleware
app.use(cors());
app.use(express.json());

// In-memory job storage (in production, use Redis or database)
const analysisJobs = new Map();

// Job statuses
const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  LIGHTHOUSE: 'lighthouse',
  LLM_ANALYSIS: 'llm_analysis',
  FORMATTING: 'formatting',
  REPORT_GENERATION: 'report_generation',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Helper function to update job status
function updateJobStatus(jobId, status, data = {}) {
  const job = analysisJobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    Object.assign(job, data);
    console.log(`📊 Analysis Job ${jobId.slice(0,8)}: ${status} - ${data.progress?.message || ''}`);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'vuxi-analysis-service',
    version: '1.0.0',
    activeJobs: Array.from(analysisJobs.values()).filter(j => 
      j.status === JOB_STATUS.RUNNING || 
      j.status === JOB_STATUS.LIGHTHOUSE || 
      j.status === JOB_STATUS.LLM_ANALYSIS ||
      j.status === JOB_STATUS.FORMATTING ||
      j.status === JOB_STATUS.REPORT_GENERATION
    ).length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Vuxi Analysis Service',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      startAnalysis: 'POST /api/analysis',
      getAnalysisStatus: 'GET /api/analysis/:jobId',
      getAllJobs: 'GET /api/jobs'
    }
  });
});

// Start analysis endpoint
app.post('/api/analysis', async (req, res) => {
  try {
    const { analysisData, captureJobId } = req.body;

    // Validate input
    if (!analysisData || !captureJobId) {
      return res.status(400).json({
        error: 'Missing required fields: analysisData and captureJobId'
      });
    }

    if (!analysisData.websiteUrl || !analysisData.organizationName || !analysisData.sitePurpose) {
      return res.status(400).json({
        error: 'Missing required analysis data fields'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'ANTHROPIC_API_KEY not configured'
      });
    }

    // Create job
    const jobId = uuidv4();
    const job = {
      id: jobId,
      captureJobId,
      status: JOB_STATUS.PENDING,
      progress: {
        stage: 'initializing',
        percentage: 0,
        message: 'Starting analysis...'
      },
      analysisData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    analysisJobs.set(jobId, job);

    console.log(`🚀 Starting analysis job ${jobId.slice(0,8)} for ${analysisData.organizationName}`);
    console.log(`📊 Screenshots to analyze: ${analysisData.screenshots?.length || 0}`);

    // Start processing (don't await)
    processAnalysis(jobId).catch(error => {
      console.error(`❌ Analysis job ${jobId} failed:`, error);
      updateJobStatus(jobId, JOB_STATUS.FAILED, {
        error: error.message,
        progress: {
          stage: 'failed',
          percentage: 0,
          message: `Analysis failed: ${error.message}`
        }
      });
    });

    res.json({
      success: true,
      jobId,
      status: JOB_STATUS.PENDING,
      message: 'Analysis job started'
    });

  } catch (error) {
    console.error('Failed to start analysis:', error);
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});

// Get analysis status
app.get('/api/analysis/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = analysisJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === JOB_STATUS.COMPLETED && {
      results: job.results
    }),
    ...(job.status === JOB_STATUS.FAILED && {
      error: job.error
    })
  });
});

// Get all jobs (for debugging)
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(analysisJobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    progress: job.progress,
    analysisData: {
      websiteUrl: job.analysisData?.websiteUrl,
      organizationName: job.analysisData?.organizationName,
      screenshotCount: job.analysisData?.screenshots?.length || 0
    }
  }));
  
  res.json(jobList);
});

// Download a remote image URL to a local file path
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

// Main analysis processing function
async function processAnalysis(jobId) {
  const job = analysisJobs.get(jobId);
  if (!job) throw new Error('Job not found');

  console.log(`🔬 Starting analysis processing: ${jobId.slice(0, 8)}`);

  try {
    // Update status to running
    updateJobStatus(jobId, JOB_STATUS.RUNNING, {
      progress: {
        stage: 'preparing',
        percentage: 10,
        message: 'Preparing analysis data...'
      }
    });

    // Extract URLs ONLY from the selected screenshots
    const { analysisData } = job;
    const screenshots = analysisData.screenshots || [];
    
    console.log(`📸 Screenshots received: ${screenshots.length}`);
    console.log(`📸 Screenshot details:`, JSON.stringify(screenshots.map(s => ({
      url: s.url,
      success: s.success,
      isCustom: s.data?.isCustom,
      hasStorageUrl: !!s.data?.storageUrl,
      storageUrl: s.data?.storageUrl?.substring(0, 80),
      filename: s.data?.filename,
      path: s.data?.path,
    })), null, 2));

    // IMPORTANT: Only process unique URLs from the screenshots array, not all files in directory
    // Multiple screenshots per URL are interaction states of the same page - deduplicate.
    // Custom uploaded screenshots may have a non-HTTP url (page name / "Custom Screenshot") —
    // for those we synthesise a URL under the main websiteUrl so they're still included.
    const baseOrigin = (() => {
      try { return new URL(analysisData.websiteUrl).origin; } catch { return analysisData.websiteUrl; }
    })();

    // First pass: patch any custom screenshots that lack a proper HTTP url
    for (const s of screenshots) {
      if (!s.success) continue;
      if (!s.url || !s.url.startsWith('http')) {
        if (s.data?.storageUrl && s.data.storageUrl.startsWith('http')) {
          const slug = (s.data?.customPageName || s.url || 'custom-page')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          s.url = `${baseOrigin}/__custom/${slug}`;
        }
      }
    }

    // Second pass: collect unique HTTP urls
    const urls = [...new Set(
      screenshots
        .filter(s => s.success && s.url && s.url.startsWith('http'))
        .map(s => s.url)
    )];

    if (urls.length === 0) {
      console.log(`⚠️ No valid screenshot URLs found, using websiteUrl as fallback`);
      urls.push(analysisData.websiteUrl);
    }

    console.log(`🎯 URLs to analyze (${urls.length}):`, urls);

    // Download any remote screenshots (e.g. Supabase uploads) into the local job desktop dir
    // so the LLM analysis service can find them by scanning the filesystem.
    // We name the file using buildFilename(url, index) so extractUrlFromFilename can
    // reconstruct the correct page URL for grouping/filtering.
    const captureDataDir = path.resolve(__dirname, '../vuxi-capture/data');
    const jobDesktopDir = path.join(captureDataDir, `job_${job.captureJobId}`, 'desktop');
    await fs.ensureDir(jobDesktopDir);

    // Count existing files so custom screenshots get a unique index beyond them
    let existingCount = 0;
    try {
      const existing = await fs.readdir(jobDesktopDir);
      existingCount = existing.filter(f => /\.(png|jpg|jpeg)$/i.test(f)).length;
    } catch (_) {}

    let customIndex = existingCount + 1;

    for (const screenshot of screenshots) {
      const storageUrl = screenshot.data?.storageUrl;
      if (!storageUrl || !storageUrl.startsWith('http')) continue;

      // Build a filename that encodes the page URL so extractUrlFromFilename works
      const pageUrl = screenshot.url;
      let localFilename;
      try {
        const urlObj = new URL(pageUrl);
        const host = urlObj.hostname.replace(/^www\./, '');
        const pathPart = urlObj.pathname.split('/').filter(Boolean).slice(0, 3).join('-')
          .replace(/[^a-z0-9-]/gi, '-');
        const safeHost = host.replace(/[^a-z0-9.-]/gi, '-');
        const remoteExt = path.extname(storageUrl.split('?')[0]) || '.png';
        localFilename = `${String(customIndex).padStart(3, '0')}_${safeHost}${pathPart ? `_${pathPart}` : ''}${remoteExt}`;
      } catch (_) {
        localFilename = `${String(customIndex).padStart(3, '0')}_custom${path.extname(storageUrl.split('?')[0]) || '.png'}`;
      }

      const destPath = path.join(jobDesktopDir, localFilename);

      if (await fs.pathExists(destPath)) {
        console.log(`⏭️  Remote screenshot already cached: ${localFilename}`);
      } else {
        try {
          console.log(`⬇️  Downloading remote screenshot for ${pageUrl}: ${storageUrl}`);
          await downloadFile(storageUrl, destPath);
          console.log(`✅  Saved to: ${destPath}`);
        } catch (err) {
          console.warn(`⚠️  Could not download remote screenshot: ${err.message}`);
          customIndex++;
          continue;
        }
      }

      // Patch the screenshot object so filenameMatches / URL deduplication works
      if (!screenshot.data) screenshot.data = {};
      screenshot.data.filename = localFilename;
      screenshot.data.path = `desktop/${localFilename}`;

      // Write a sidecar URL map so the analyzer can load the correct page URL
      const urlMapPath = path.join(jobDesktopDir, 'url-map.json');
      let urlMap = {};
      try { urlMap = await fs.readJson(urlMapPath); } catch (_) {}
      urlMap[localFilename] = screenshot.url;
      await fs.writeJson(urlMapPath, urlMap).catch(() => {});

      customIndex++;
    }

    // Run the actual analysis with ONLY the selected URLs
    const analysisInput = {
      urls: urls,
      organizationName: analysisData.organizationName,
      organizationType: 'organization',
      organizationPurpose: analysisData.sitePurpose,
      captureJobId: job.captureJobId
    };

    const stageStatusMap = {
      lighthouse: JOB_STATUS.LIGHTHOUSE,
      llm_analysis: JOB_STATUS.LLM_ANALYSIS,
      formatting: JOB_STATUS.FORMATTING,
      report_generation: JOB_STATUS.REPORT_GENERATION,
    };

    const onProgress = (stage, percentage, message) => {
      updateJobStatus(jobId, stageStatusMap[stage] || JOB_STATUS.RUNNING, {
        progress: { stage, percentage, message }
      });
    };

    console.log('🔬 Running analysis with input:', {
      urlCount: analysisInput.urls.length,
      urls: analysisInput.urls,
      organizationName: analysisInput.organizationName
    });

    const result = await analysis(analysisInput, onProgress);

    console.log('📋 Analysis completed:', {
      success: result.success,
      hasReportData: !!result.reportData,
      hasLighthouse: !!result.lighthouse,
      hasLLMAnalysis: !!result.llmAnalysis,
      error: result.error
    });

    if (result.success) {
      updateJobStatus(jobId, JOB_STATUS.COMPLETED, {
        results: {
          reportPath: result.reportPath,
          lighthouse: result.lighthouse,
          llmAnalysis: result.llmAnalysis,
          formatting: result.formatting,
          htmlReport: result.htmlReport,
          reportData: result.reportData // IMPORTANT: Include reportData
        },
        progress: {
          stage: 'completed',
          percentage: 100,
          message: `Analysis completed successfully for ${urls.length} page${urls.length === 1 ? '' : 's'}!`
        }
      });

      console.log(`✅ Analysis job ${jobId.slice(0,8)} completed successfully with report data`);
    } else {
      throw new Error(result.error || 'Analysis failed');
    }

  } catch (error) {
    console.error(`❌ Analysis job ${jobId.slice(0, 8)} failed:`, error);
    updateJobStatus(jobId, JOB_STATUS.FAILED, {
      error: error.message,
      progress: {
        stage: 'failed',
        percentage: 0,
        message: `Analysis failed: ${error.message}`
      }
    });
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🔬 Analysis Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API docs: http://localhost:${PORT}/api/jobs`);
  console.log(`🏠 Root endpoint: http://localhost:${PORT}/`);
  
  // Check required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY not set in environment variables');
  } else {
    console.log('✅ ANTHROPIC_API_KEY configured');
  }
});

module.exports = app;