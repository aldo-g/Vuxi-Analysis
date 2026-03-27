const fs = require('fs-extra');
const path = require('path');

class ReportGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir || '/app/data/reports'; 
    this.screenshotsSourceDir = options.screenshotsSourceDir || options.screenshotsDir || '/app/data/screenshots';
    this.usedIds = new Set();

    console.log(`📁 ReportGenerator initialized:`);
    console.log(`   Screenshots source: ${this.screenshotsSourceDir}`);
  }

  async generateTemporaryReport(analysisData) {
    try {
      console.log(`🔍 Generating temporary report for immediate display`);

      // Reset used IDs for each generation
      this.usedIds.clear();

      // Process the analysis data for Next.js consumption
      const reportData = await this.prepareReportDataForNextJs(analysisData);

      console.log(`✅ Temporary report data prepared successfully`);
      return {
        success: true,
        reportData: reportData,
        reportId: `temp_${Date.now()}` // Temporary ID for this session
      };
    } catch (error) {
      console.error(`❌ Error generating temporary report: ${error.message}`);
      console.error(error.stack);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async prepareReportDataForNextJs(analysisData) {
    console.log('  📊 Preparing report data for Next.js...');
    
    if (!analysisData || !analysisData.page_analyses || !analysisData.overall_summary || !analysisData.metadata) {
      throw new Error('Invalid analysisData structure: missing overall_summary, page_analyses, or metadata.');
    }

    const processedPageAnalyses = analysisData.page_analyses.map((page, index) => {
      const pageId = this.createUniquePageId(page, index);
      const screenshotFilename = this.findActualScreenshotFilename(page.url, index, analysisData.page_analyses);
      
      return {
        ...page,
        id: pageId,
        detailed_analysis: this.cleanAnalysisContent(page.original_analysis || ''), 
        raw_analysis: page.original_analysis || 'No raw analysis data.',
        screenshot_path: screenshotFilename ? `temp_screenshots/${screenshotFilename}` : null
      };
    });

    const reportData = {
      organization: analysisData.metadata.organization_name || 'Analysis Report',
      analysis_date: new Date().toISOString(),
      timestamp: analysisData.timestamp || new Date().toISOString(),
      overall_summary: {
        ...analysisData.overall_summary,
        total_pages_analyzed: processedPageAnalyses.length
      },
      page_analyses: processedPageAnalyses,
      metadata: {
        organization_name: analysisData.metadata.organization_name,
        generated_at: new Date().toISOString(),
        total_pages: processedPageAnalyses.length
      },
      // Add screenshot data directly to the report
      screenshots: await this.getScreenshotData()
    };

    console.log(`    ✅ Report data prepared for ${processedPageAnalyses.length} pages`);
    return reportData;
  }

  async getScreenshotData() {
    console.log('  📸 Collecting screenshot data...');
    
    try {
      // Check for screenshots in desktop subdirectory first
      const desktopDir = path.join(this.screenshotsSourceDir, 'desktop');
      const sourceDir = await fs.pathExists(desktopDir) ? desktopDir : this.screenshotsSourceDir;
      
      if (!await fs.pathExists(sourceDir)) {
        console.log(`    ⚠️  Screenshots directory not found: ${sourceDir}`);
        return {};
      }

      const files = await fs.readdir(sourceDir);
      const screenshotFiles = files.filter(file => file.toLowerCase().endsWith('.png'));
      
      if (screenshotFiles.length === 0) {
        console.log(`    ⚠️  No screenshot files found in: ${sourceDir}`);
        return {};
      }

      const screenshotData = {};
      for (const file of screenshotFiles) {
        const filePath = path.join(sourceDir, file);
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');
        screenshotData[file] = `data:image/png;base64,${base64}`;
      }
      
      console.log(`    ✅ ${screenshotFiles.length} screenshots encoded to base64`);
      return screenshotData;
    } catch (error) {
      console.error(`    ❌ Error collecting screenshot data: ${error.message}`);
      return {};
    }
  }

  createUniquePageId(page, index) {
    const baseId = page.id || 
                   page.title?.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30) || 
                   `page-${index}`;
    
    let uniqueId = baseId;
    let counter = 1;
    
    while (this.usedIds.has(uniqueId)) {
      uniqueId = `${baseId}-${counter}`;
      counter++;
    }
    
    this.usedIds.add(uniqueId);
    return uniqueId;
  }
  
  findActualScreenshotFilename(url, index, allPageAnalyses) {
    const sourceBaseDir = path.join(this.screenshotsSourceDir, 'desktop');
    let filesInSourceDir = [];
    if (fs.existsSync(sourceBaseDir)) {
      filesInSourceDir = fs.readdirSync(sourceBaseDir);
    } else if (fs.existsSync(this.screenshotsSourceDir)) {
      filesInSourceDir = fs.readdirSync(this.screenshotsSourceDir);
    }
    
    const pngFiles = filesInSourceDir.filter(f => f.endsWith('.png')).sort();

    if (pngFiles[index]) {
      return pngFiles[index];
    }

    const generatedName = this.generateScreenshotFilenameFromUrl(url, index);
    return generatedName;
  }

  generateScreenshotFilenameFromUrl(url, index) {
    if (!url && index === undefined) return 'placeholder.png';
    try {
      const urlObj = new URL(url || 'http://localhost');
      let domain = urlObj.hostname.replace(/^www\./, '');
      let pathname = (urlObj.pathname + urlObj.search + urlObj.hash)
        .replace(/^\/+|\/+$/g, '')
        .replace(/[\/\?\=\&\#]/g, '_')
        .replace(/[^a-zA-Z0-9_-]/g, '') || 'index';

      if (pathname.length > 50) {
        pathname = pathname.substring(0, 50);
      }
      const safeIndex = String(index !== undefined ? index : 0).padStart(3, '0');
      return `${safeIndex}_${domain}_${pathname}.png`;
    } catch (error) {
      const safeIndex = String(index !== undefined ? index : 0).padStart(3, '0');
      return `${safeIndex}_invalid_url.png`;
    }
  }
  
  cleanAnalysisContent(analysisText) {
    if (!analysisText) return '';
    return analysisText.trim(); 
  }
}

module.exports = { ReportGenerator };