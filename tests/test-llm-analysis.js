const fs = require('fs-extra');
const path = require('path');
const { LLMAnalysisService } = require('../src/services/llm-analysis');

// Configuration for different organization types
const ORG_CONFIGS = {
  'ecommerce': {
    org_name: 'Demo E-commerce Store',
    org_type: 'e-commerce business',
    org_purpose: 'to convert visitors into customers, increase sales, and provide excellent online shopping experience'
  },
  'nonprofit': {
    org_name: 'Demo Non-Profit Organization',
    org_type: 'non-profit organization',
    org_purpose: 'to encourage donations, volunteer sign-ups, and spread awareness of its mission'
  },
  'corporate': {
    org_name: 'Demo Corporation',
    org_type: 'business corporation',
    org_purpose: 'to generate leads, showcase services, and establish trust with potential clients'
  },
  'portfolio': {
    org_name: 'Demo Professional Portfolio',
    org_type: 'personal brand',
    org_purpose: 'to showcase skills and experience to attract job opportunities or freelance clients'
  },
  'blog': {
    org_name: 'Demo Blog/Media Site',
    org_type: 'content publication',
    org_purpose: 'to engage readers, increase time on site, and build a loyal audience'
  },
  'saas': {
    org_name: 'Demo SaaS Platform',
    org_type: 'software-as-a-service company',
    org_purpose: 'to convert visitors into trial users and paying subscribers'
  },
  'custom': {
    org_name: process.env.TEST_ORG_NAME || 'Demo Organization',
    org_type: process.env.TEST_ORG_TYPE || 'organization',
    org_purpose: process.env.TEST_ORG_PURPOSE || 'to achieve its business goals and serve its users effectively'
  }
};

function getOrgConfig() {
  // Check command line arguments first
  const args = process.argv.slice(2);
  const configArg = args.find(arg => arg.startsWith('--org='));
  
  if (configArg) {
    const orgType = configArg.split('=')[1];
    if (ORG_CONFIGS[orgType]) {
      console.log(`📋 Using predefined config for: ${orgType}`);
      return ORG_CONFIGS[orgType];
    } else {
      console.log(`❌ Unknown org type: ${orgType}`);
      console.log(`Available types: ${Object.keys(ORG_CONFIGS).join(', ')}`);
      process.exit(1);
    }
  }
  
  // Check environment variables
  if (process.env.TEST_ORG_NAME || process.env.TEST_ORG_TYPE || process.env.TEST_ORG_PURPOSE) {
    console.log('📋 Using custom config from environment variables');
    return ORG_CONFIGS.custom;
  }
  
  // Default to a generic configuration
  console.log('📋 Using default generic configuration');
  return {
    org_name: 'Test Organization',
    org_type: 'organization',
    org_purpose: 'to achieve its business goals and serve its users effectively'
  };
}

async function testLLMAnalysisService() {
  console.log('🧪 Testing LLM Analysis Service...\n');
  
  // Get organization configuration
  const orgConfig = getOrgConfig();
  console.log(`🏢 Organization: ${orgConfig.org_name}`);
  console.log(`🏷️  Type: ${orgConfig.org_type}`);
  console.log(`🎯 Purpose: ${orgConfig.org_purpose}\n`);
  
  try {
    // Check if API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('❌ ANTHROPIC_API_KEY environment variable is not set');
      console.log('Please set your API key with: export ANTHROPIC_API_KEY=your-api-key');
      return;
    }
    
    // Check prerequisites
    const screenshotsDir = './data/screenshots';
    const lighthouseDir = './data/lighthouse';
    
    const screenshotsExist = await fs.pathExists(path.join(screenshotsDir, 'desktop'));
    const lighthouseExists = await fs.pathExists(path.join(lighthouseDir, 'trimmed'));
    
    if (!screenshotsExist) {
      console.log('❌ No screenshots found. Please run screenshot test first.');
      console.log('   Run: npm run test:screenshot');
      return;
    }
    
    if (!lighthouseExists) {
      console.log('❌ No lighthouse data found. Please run lighthouse test first.');
      console.log('   Run: npm run test:lighthouse');
      return;
    }
    
    console.log('✅ Prerequisites found');
    console.log(`📸 Screenshots directory: ${screenshotsDir}`);
    console.log(`🚦 Lighthouse directory: ${lighthouseDir}`);
    
    // Count available data
    const screenshots = await fs.readdir(path.join(screenshotsDir, 'desktop'));
    const lighthouse = await fs.readdir(path.join(lighthouseDir, 'trimmed'));
    const screenshotCount = screenshots.filter(f => f.endsWith('.png')).length;
    const lighthouseCount = lighthouse.filter(f => f.endsWith('.json')).length;
    
    console.log(`📊 Found ${screenshotCount} screenshots and ${lighthouseCount} lighthouse reports`);
    
    // Initialize service with organization configuration
    const service = new LLMAnalysisService({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      screenshotsDir: screenshotsDir,
      lighthouseDir: lighthouseDir,
      outputDir: './data/analysis',
      // Pass organization configuration
      org_name: orgConfig.org_name,
      org_type: orgConfig.org_type,
      org_purpose: orgConfig.org_purpose
    });
    
    console.log('\n🤖 Starting LLM analysis (this will take several minutes)...');
    console.log('⚠️  This test requires API calls and may take 3-5 minutes');
    
    // Run analysis
    const result = await service.analyze();
    
    if (result.success) {
      console.log('\n✅ LLM Analysis test PASSED');
      console.log(`⏱️  Duration: ${result.stats.duration.toFixed(2)}s`);
      console.log(`📸 Screenshots analyzed: ${result.stats.screenshots}`);
      console.log(`🚦 Lighthouse reports analyzed: ${result.stats.lighthouseReports}`);
      console.log(`📄 Page analyses generated: ${result.stats.pageAnalyses}`);
      console.log(`📁 Analysis saved to: ${result.files.analysis}`);
      console.log(`📄 Metadata saved to: ${result.files.metadata}`);
      
      // Verify files were created
      const analysisExists = await fs.pathExists(result.files.analysis);
      const metadataExists = await fs.pathExists(result.files.metadata);
      
      if (analysisExists && metadataExists) {
        console.log('\n✅ Files verified:');
        
        // Check file sizes
        const analysisStats = await fs.stat(result.files.analysis);
        const metadataStats = await fs.stat(result.files.metadata);
        
        console.log(`   📄 analysis.json: ${(analysisStats.size / 1024).toFixed(2)} KB`);
        console.log(`   📄 analysis-metadata.json: ${(metadataStats.size / 1024).toFixed(2)} KB`);
        
        // Show analysis structure
        const analysisData = await fs.readJson(result.files.analysis);
        console.log('\n📊 Analysis structure:');
        console.log(`   🕒 Timestamp: ${analysisData.timestamp}`);
        console.log(`   🤖 Provider: ${analysisData.provider}`);
        console.log(`   📝 Model: ${analysisData.model}`);
        console.log(`   🏢 Organization: ${analysisData.orgContext?.org_name || 'Not specified'}`);
        console.log(`   📄 Page analyses: ${analysisData.pageAnalyses?.length || 0}`);
        console.log(`   🔧 Technical summary: ${analysisData.technicalSummary ? 'Generated' : 'Missing'}`);
        console.log(`   📊 Overview: ${analysisData.overview ? 'Generated' : 'Missing'}`);
        
        // Show sample page analysis
        if (analysisData.pageAnalyses && analysisData.pageAnalyses.length > 0) {
          const firstPage = analysisData.pageAnalyses[0];
          console.log(`\n📋 Sample page analysis:`);
          console.log(`   🌐 URL: ${firstPage.url}`);
          console.log(`   📝 Analysis length: ${firstPage.analysis?.length || 0} characters`);
        }
        
      } else {
        console.log('❌ Expected files NOT found');
      }
      
    } else {
      console.log('❌ LLM Analysis test FAILED');
      console.log(`Error: ${result.error}`);
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
    if (error.message.includes('API key')) {
      console.log('💡 Make sure your ANTHROPIC_API_KEY is set correctly');
    }
  }
  
  console.log('\n🏁 LLM Analysis test completed');
}

// Show usage information
function showUsage() {
  console.log('\n📋 Usage examples:');
  console.log('  npm run test:llm-analysis');
  console.log('  npm run test:llm-analysis -- --org=ecommerce');
  console.log('  npm run test:llm-analysis -- --org=nonprofit');
  console.log('  npm run test:llm-analysis -- --org=corporate');
  console.log('  npm run test:llm-analysis -- --org=portfolio');
  console.log('  npm run test:llm-analysis -- --org=blog');
  console.log('  npm run test:llm-analysis -- --org=saas');
  console.log('  npm run test:llm-analysis -- --org=custom  # Uses environment variables');
  
  console.log('\n🌍 Environment variables for custom config:');
  console.log('  export TEST_ORG_NAME="Your Organization Name"');
  console.log('  export TEST_ORG_TYPE="your organization type"');
  console.log('  export TEST_ORG_PURPOSE="your organization purpose"');
  console.log('');
}

// Check if help was requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
  process.exit(0);
}

// Run the test
testLLMAnalysisService().catch(console.error);