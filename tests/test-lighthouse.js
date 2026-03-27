const fs = require('fs-extra');
const path = require('path');
const { LighthouseService } = require('../src/services/lighthouse');

async function testLighthouseService() {
  console.log('🧪 Testing Lighthouse Service...\n');
  
  try {
    // Load URLs from previous URL discovery test
    const urlsPath = './data/urls_simple.json';
    let testUrls = [];
    
    if (await fs.pathExists(urlsPath)) {
      console.log('📥 Loading URLs from previous URL discovery...');
      const urls = await fs.readJson(urlsPath);
      // Take just the first 2 URLs for testing (lighthouse is slow)
      testUrls = urls.slice(0, 50);
      console.log(`   Found ${urls.length} URLs, using first ${testUrls.length} for testing`);
    } else {
      console.log('📝 No URLs found, using test URLs...');
      testUrls = [
        'https://edinburghpeaceinstitute.org',
        'https://edinburghpeaceinstitute.org/training'
      ];
    }
    
    console.log('📋 URLs to audit:');
    testUrls.forEach((url, i) => console.log(`   ${i + 1}. ${url}`));
    
    // Initialize service
    const service = new LighthouseService({
      outputDir: './data/lighthouse',
      retries: 1  // Keep retries low for testing
    });
    
    // Run audits
    console.log('\n🚦 Starting Lighthouse audits (this may take a few minutes)...');
    const result = await service.auditAll(testUrls);
    
    if (result.success || result.successful.length > 0) {
      console.log('\n✅ Lighthouse test PASSED');
      console.log(`🚦 Completed ${result.successful.length} audits successfully`);
      console.log(`⏱️  Duration: ${result.stats.duration.toFixed(2)}s`);
      console.log(`📁 Reports saved to: ${result.files.reportsDir}`);
      console.log(`📁 Trimmed reports saved to: ${result.files.trimmedDir}`);
      console.log(`📄 Summary saved to: ${result.files.summary}`);
      
      // Verify files were created
      const reportsExist = await fs.pathExists(result.files.reportsDir);
      const trimmedExist = await fs.pathExists(result.files.trimmedDir);
      const summaryExists = await fs.pathExists(result.files.summary);
      
      if (reportsExist && trimmedExist && summaryExists) {
        console.log(`\n✅ Files verified:`);
        
        // Count report files
        const reports = await fs.readdir(result.files.reportsDir);
        const trimmed = await fs.readdir(result.files.trimmedDir);
        const reportCount = reports.filter(f => f.endsWith('.json')).length;
        const trimmedCount = trimmed.filter(f => f.endsWith('.json')).length;
        
        console.log(`   📊 ${reportCount} full reports`);
        console.log(`   📋 ${trimmedCount} trimmed reports`);
        console.log(`   📄 Summary file exists`);
        
        // Show sample performance scores
        console.log('\n📈 Performance Results:');
        result.successful.forEach((audit, i) => {
          const perfScore = Math.round(audit.data.metrics.performance * 100);
          const accessScore = Math.round(audit.data.metrics.accessibility * 100);
          console.log(`   ${i + 1}. ${audit.data.url}`);
          console.log(`      Performance: ${perfScore}% | Accessibility: ${accessScore}%`);
        });
        
        // Show failures if any
        if (result.failed.length > 0) {
          console.log(`\n⚠️  ${result.failed.length} failed audits:`);
          result.failed.forEach(failure => {
            console.log(`   ❌ ${failure.url}: ${failure.error}`);
          });
        }
        
      } else {
        console.log('❌ Expected files NOT found');
      }
      
    } else {
      console.log('❌ Lighthouse test FAILED');
      console.log(`Error: ${result.error}`);
      if (result.failed.length > 0) {
        console.log('Failed audits:');
        result.failed.forEach(failure => {
          console.log(`   ❌ ${failure.url}: ${failure.error}`);
        });
      }
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
  }
  
  console.log('\n🏁 Lighthouse test completed');
}

// Run the test
testLighthouseService().catch(console.error);