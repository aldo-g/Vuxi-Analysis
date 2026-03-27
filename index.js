require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const { LighthouseService } = require('./lighthouse');
const { LLMAnalysisService } = require('./llm-analysis');
const { FormattingService } = require('./formatting');
const { HTMLReportService } = require('./html-report');

async function analysis(data) {
  const { urls, organizationName, organizationType, organizationPurpose } = data;
  
  console.log(`🔬 Starting analysis for: ${organizationName}`);
  console.log(`🎯 URLs to analyze: ${urls.length} - ${urls.join(', ')}`);
  
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is not set');
    return { success: false, error: 'ANTHROPIC_API_KEY not configured' };
  }
  
  // Find root data directory - go up from current working directory
  const rootDir = path.resolve(process.cwd(), '../..');
  const dataDir = path.join(rootDir, 'data');
  
  console.log(`📁 Using data directory: ${dataDir}`);
  
  // Run Lighthouse audits ONLY for the specified URLs
  const lighthouseService = new LighthouseService({
    outputDir: path.join(dataDir, 'lighthouse')
  });
  const lighthouseResult = await lighthouseService.auditAll(urls); // Pass specific URLs
  
  // Run LLM analysis with correct paths and SPECIFIC URLs
  const llmService = new LLMAnalysisService({
    screenshotsDir: path.join(dataDir, 'screenshots', 'desktop'),
    lighthouseDir: path.join(dataDir, 'lighthouse', 'trimmed'),
    outputDir: path.join(dataDir, 'analysis'),
    org_name: organizationName,
    org_type: organizationType || 'organization',
    org_purpose: organizationPurpose,
    specificUrls: urls // PASS THE SPECIFIC URLs HERE
  });
  const llmResult = await llmService.analyze();
  
  if (!llmResult.success) {
    return { success: false, error: llmResult.error, lighthouse: lighthouseResult };
  }
  
  // Format the analysis
  const formattingService = new FormattingService({
    inputPath: path.join(dataDir, 'analysis', 'analysis.json'),
    outputPath: path.join(dataDir, 'analysis', 'structured-analysis.json')
  });
  const formattingResult = await formattingService.format();
  
  if (!formattingResult.success) {
    return { success: false, error: formattingResult.error, lighthouse: lighthouseResult, llmAnalysis: llmResult };
  }
  
  // Generate TEMPORARY report (no saving to disk)
  const htmlService = new HTMLReportService({
    outputDir: path.join(dataDir, 'reports'),
    screenshotsDir: path.join(dataDir, 'screenshots')
  });
  const htmlResult = await htmlService.generateTemporaryFromFile(path.join(dataDir, 'analysis', 'structured-analysis.json'));
  
  return {
    success: htmlResult.success,
    lighthouse: lighthouseResult,
    llmAnalysis: llmResult,
    formatting: formattingResult,
    htmlReport: htmlResult,
    // Return the report data for immediate display
    reportData: htmlResult.reportData,
    reportId: htmlResult.reportId
  };
}

module.exports = { analysis };