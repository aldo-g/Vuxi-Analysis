require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const { LighthouseService } = require('./lighthouse');
const { LLMAnalysisService } = require('./llm-analysis');
const { FormattingService } = require('./formatting');
const { HTMLReportService } = require('./html-report');

async function analysis(data, onProgress) {
  const { urls, organizationName, organizationType, organizationPurpose, captureJobId } = data;
  const notify = onProgress || (() => {});

  console.log(`🔬 Starting analysis for: ${organizationName}`);
  console.log(`🎯 URLs to analyze: ${urls.length} - ${urls.join(', ')}`);
  console.log(`📦 Capture job: ${captureJobId}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is not set');
    return { success: false, error: 'ANTHROPIC_API_KEY not configured' };
  }

  // Screenshots live in the capture service's job directory
  const captureDataDir = path.resolve(__dirname, '../vuxi-capture/data');
  const jobDir = path.join(captureDataDir, `job_${captureJobId}`);
  const screenshotsDir = path.join(jobDir, 'desktop');

  // Analysis outputs go in the analysis service's own data directory
  const analysisDataDir = path.resolve(__dirname, 'data');

  console.log(`📸 Screenshots dir: ${screenshotsDir}`);
  console.log(`📁 Analysis output: ${analysisDataDir}`);

  await require('fs-extra').ensureDir(path.join(analysisDataDir, 'analysis'));
  await require('fs-extra').ensureDir(path.join(analysisDataDir, 'lighthouse'));
  await require('fs-extra').ensureDir(path.join(analysisDataDir, 'reports'));

  // Run Lighthouse audits
  notify('lighthouse', 20, `Running Lighthouse performance audit...`);
  const lighthouseService = new LighthouseService({
    outputDir: path.join(analysisDataDir, 'lighthouse')
  });
  const lighthouseResult = await lighthouseService.auditAll(urls);

  // Run LLM analysis pointing at the correct job screenshot directory
  notify('llm_analysis', 45, `Analyzing screenshots with AI...`);
  const llmService = new LLMAnalysisService({
    screenshotsDir,
    lighthouseDir: path.join(analysisDataDir, 'lighthouse', 'trimmed'),
    outputDir: path.join(analysisDataDir, 'analysis'),
    org_name: organizationName,
    org_type: organizationType || 'organization',
    org_purpose: organizationPurpose,
    specificUrls: urls
  });
  const llmResult = await llmService.analyze();
  
  if (!llmResult.success) {
    return { success: false, error: llmResult.error, lighthouse: lighthouseResult };
  }
  
  // Format the analysis
  notify('formatting', 75, 'Structuring analysis results...');
  const formattingService = new FormattingService({
    inputPath: path.join(analysisDataDir, 'analysis', 'analysis.json'),
    outputPath: path.join(analysisDataDir, 'analysis', 'structured-analysis.json')
  });
  const formattingResult = await formattingService.format();

  if (!formattingResult.success) {
    return { success: false, error: formattingResult.error, lighthouse: lighthouseResult, llmAnalysis: llmResult };
  }

  // Generate report
  notify('report_generation', 90, 'Generating report...');
  const htmlService = new HTMLReportService({
    outputDir: path.join(analysisDataDir, 'reports'),
    screenshotsDir
  });
  const htmlResult = await htmlService.generateTemporaryFromFile(path.join(analysisDataDir, 'analysis', 'structured-analysis.json'));
  
  return {
    success: htmlResult.success,
    lighthouse: lighthouseResult,
    llmAnalysis: llmResult,
    formatting: formattingResult,
    htmlReport: htmlResult,
    reportData: htmlResult.reportData,
    reportId: htmlResult.reportId
  };
}

module.exports = { analysis };
