const fs = require('fs-extra');
const path = require('path');
const { HTMLReportService } = require('../src/services/html-report');

async function testHTMLReportService() {
  console.log('🧪 Testing HTML Report Service...\n');
  
  try {
    // Check if we have analysis data from previous LLM analysis test
    const analysisPath = './data/analysis/structured-analysis.json';
    let testMode = 'file';
    
    if (await fs.pathExists(analysisPath)) {
      console.log('📥 Found structured analysis data...');
      
      // Test using analysis file
      console.log('🧪 Testing with structured analysis file...');
      
      const service = new HTMLReportService({
        outputDir: './data/reports',
        screenshotsDir: './data/screenshots'
      });
      
      const result = await service.generateFromFile(analysisPath);
      
      if (result.success) {
        console.log('\n✅ HTML Report test PASSED');
        console.log(`📄 Generated reports in ${result.outputDir}`);
        console.log(`⏱️  Duration: ${result.duration.toFixed(2)}s`);
        
        // Check for our new file structure
        const expectedFiles = [
          path.join(result.outputDir, 'overview.html'),
          path.join(result.outputDir, 'screenshots')
        ];
        
        console.log('\n✅ Verifying generated files:');
        for (const filePath of expectedFiles) {
          if (await fs.pathExists(filePath)) {
            if (filePath.endsWith('.html')) {
              const stats = await fs.stat(filePath);
              console.log(`   ✅ ${path.basename(filePath)} (${(stats.size / 1024).toFixed(2)} KB)`);
            } else {
              console.log(`   ✅ ${path.basename(filePath)} (directory)`);
            }
          } else {
            console.log(`   ❌ ${path.basename(filePath)} - NOT FOUND`);
          }
        }
        
        // Check for individual page files
        const reportFiles = await fs.readdir(result.outputDir);
        const pageFiles = reportFiles.filter(f => f.endsWith('.html') && f !== 'overview.html');
        console.log(`   📄 ${pageFiles.length} individual page files: ${pageFiles.join(', ')}`);
        
        // Check screenshots were copied
        const screenshotsDir = path.join(result.outputDir, 'screenshots');
        if (await fs.pathExists(screenshotsDir)) {
          const screenshots = await fs.readdir(screenshotsDir);
          const pngFiles = screenshots.filter(f => f.endsWith('.png'));
          console.log(`   📸 ${pngFiles.length} screenshots copied`);
        }
        
        console.log('\n🌐 Open the main report at: data/reports/overview.html');
        
      } else {
        console.log('❌ HTML Report test FAILED');
        console.log(`Error: ${result.error}`);
      }
      
    } else {
      console.log('📝 No structured analysis data found, testing with mock data...');
      
      // Test with mock analysis data in the new format
      const mockAnalysisData = {
        timestamp: new Date().toISOString(),
        overall_summary: {
          executive_summary: 'This is a test executive summary for HTML report generation using the new structured format.',
          overall_score: 7,
          total_pages_analyzed: 2,
          most_critical_issues: [
            'Navigation consistency needs improvement across all pages',
            'Call-to-action buttons lack prominence and visual hierarchy'
          ],
          top_recommendations: [
            'Implement consistent navigation design patterns',
            'Enhance CTA button visibility with contrasting colors',
            'Add clear value propositions to landing pages'
          ],
          key_strengths: [
            'Clean visual design with good use of whitespace',
            'Strong technical performance and accessibility scores',
            'Professional branding and consistent color scheme'
          ],
          performance_summary: 'Overall performance is excellent with fast load times and good accessibility scores.'
        },
        page_analyses: [
          {
            page_type: 'Homepage',
            title: 'Homepage Analysis',
            url: 'https://example.com',
            overall_score: 6,
            key_issues: [
              'Missing prominent call-to-action buttons',
              'Value proposition is not immediately clear'
            ],
            recommendations: [
              'Add a hero section with clear value proposition',
              'Implement prominent CTA buttons above the fold'
            ],
            summary: 'Homepage has good visual design but lacks conversion optimization elements.',
            original_analysis: 'Detailed analysis of the homepage including UX/UI evaluation...'
          },
          {
            page_type: 'Contact Page',
            title: 'Contact Page Analysis', 
            url: 'https://example.com/contact',
            overall_score: 8,
            key_issues: [
              'Form could benefit from better field labels'
            ],
            recommendations: [
              'Improve form accessibility with better labels',
              'Add confirmation messaging after form submission'
            ],
            summary: 'Contact page is well-implemented with good usability.',
            original_analysis: 'Detailed analysis of the contact page including form usability...'
          }
        ],
        metadata: {
          total_pages: 2,
          analysis_provider: 'test',
          generated_at: new Date().toISOString()
        }
      };
      
      const service = new HTMLReportService({
        outputDir: './data/reports',
        screenshotsDir: './data/screenshots'
      });
      
      const result = await service.generate(mockAnalysisData);
      
      if (result.success) {
        console.log('\n✅ HTML Report test with mock data PASSED');
        console.log(`📄 Generated ${result.generatedFiles?.length || 'several'} files`);
        console.log(`⏱️  Duration: ${result.duration.toFixed(2)}s`);
        console.log('\n🌐 Open the report at: data/reports/overview.html');
      } else {
        console.log('❌ HTML Report test with mock data FAILED');
        console.log(`Error: ${result.error}`);
      }
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
    console.error(error.stack);
  }
  
  console.log('\n🏁 HTML Report test completed');
}

// Run the test
testHTMLReportService().catch(console.error);