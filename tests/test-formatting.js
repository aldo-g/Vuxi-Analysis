const fs = require('fs-extra');
const path = require('path');
const { FormattingService } = require('../formatting');

// Configuration for different organization types (same as LLM test)
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
  
  // Default: try to extract from existing analysis file
  return null; // Will be extracted from analysis data
}

async function testFormattingService() {
  console.log('🧪 Testing Formatting Service...\n');
  
  // Get organization configuration
  const orgConfig = getOrgConfig();
  if (orgConfig) {
    console.log(`🏢 Organization: ${orgConfig.org_name}`);
    console.log(`🏷️  Type: ${orgConfig.org_type}`);
    console.log(`🎯 Purpose: ${orgConfig.org_purpose}\n`);
  } else {
    console.log('📋 Organization context will be extracted from analysis data\n');
  }
  
  try {
    // Check if API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('❌ ANTHROPIC_API_KEY environment variable is not set');
      console.log('Please set your API key with: export ANTHROPIC_API_KEY=your-api-key');
      return;
    }
    
    // Check prerequisites
    const analysisPath = './data/analysis/analysis.json';
    
    if (!await fs.pathExists(analysisPath)) {
      console.log('❌ No raw analysis data found. Please run LLM analysis test first.');
      console.log('   Run: npm run test:llm-analysis');
      return;
    }
    
    console.log('✅ Prerequisites found');
    console.log(`📄 Raw analysis file: ${analysisPath}`);
    
    // Check analysis file content
    const rawData = await fs.readJson(analysisPath);
    const analysisKeys = Object.keys(rawData);
    console.log(`📊 Analysis data structure: ${analysisKeys.join(', ')}`);
    
    // Show organization context from analysis data if available
    if (rawData.orgContext && !orgConfig) {
      console.log(`🏢 Found organization context in analysis data:`);
      console.log(`   Name: ${rawData.orgContext.org_name}`);
      console.log(`   Type: ${rawData.orgContext.org_type}`);
      console.log(`   Purpose: ${rawData.orgContext.org_purpose}`);
    }
    
    // Initialize service with optional organization override
    const serviceOptions = {
      model: 'claude-3-7-sonnet-20250219',
      inputPath: analysisPath,
      outputPath: './data/analysis/structured-analysis.json'
    };
    
    // Add organization context if provided
    if (orgConfig) {
      serviceOptions.orgContext = orgConfig;
    }
    
    const service = new FormattingService(serviceOptions);
    
    console.log('\n🔄 Starting formatting (this may take 1-2 minutes)...');
    console.log('⚠️  This test requires API calls and may cost credits');
    
    // Run formatting
    const result = await service.format();
    
    if (result.success) {
      console.log('\n✅ Formatting test PASSED');
      console.log(`⏱️  Duration: ${result.stats.duration.toFixed(2)}s`);
      console.log(`📥 Input size: ${(result.stats.inputSize / 1024).toFixed(2)} KB`);
      console.log(`📤 Output size: ${(result.stats.outputSize / 1024).toFixed(2)} KB`);
      console.log(`📁 Structured data saved to: ${result.files.output}`);
      
      // Verify file was created
      const outputExists = await fs.pathExists(result.files.output);
      
      if (outputExists) {
        console.log('\n✅ File verified:');
        
        // Check file size
        const outputStats = await fs.stat(result.files.output);
        console.log(`   📄 structured-analysis.json: ${(outputStats.size / 1024).toFixed(2)} KB`);
        
        // Show structured data structure
        const structuredData = await fs.readJson(result.files.output);
        console.log('\n📊 Structured data contains:');
        console.log(`   🏢 Organization: ${structuredData.orgContext?.org_name || 'Not specified'}`);
        console.log(`   📋 Overall summary: ${structuredData.overall_summary ? 'Generated' : 'Missing'}`);
        console.log(`   📄 Page analyses: ${structuredData.page_analyses?.length || 0}`);
        console.log(`   ❌ Critical issues: ${structuredData.overall_summary?.most_critical_issues?.length || 0}`);
        console.log(`   💡 Recommendations: ${structuredData.overall_summary?.top_recommendations?.length || 0}`);
        console.log(`   ✅ Strengths: ${structuredData.overall_summary?.key_strengths?.length || 0}`);
        
        // Show overall score if available
        if (structuredData.overall_summary?.overall_score) {
          console.log(`\n🎯 Overall Score: ${structuredData.overall_summary.overall_score}/10`);
          if (structuredData.overall_summary.site_score_explanation) {
            console.log(`📝 Score Explanation: ${structuredData.overall_summary.site_score_explanation}`);
          }
        }
        
        // Show sample page analysis if available
        if (structuredData.page_analyses && structuredData.page_analyses.length > 0) {
          console.log('\n📋 Sample page analysis:');
          const firstPage = structuredData.page_analyses[0];
          console.log(`   🌐 URL: ${firstPage.url}`);
          console.log(`   📊 Page Type: ${firstPage.page_type}`);
          console.log(`   🎯 Score: ${firstPage.overall_score}/10`);
          console.log(`   ❌ Issues: ${firstPage.key_issues?.length || 0}`);
          console.log(`   💡 Recommendations: ${firstPage.recommendations?.length || 0}`);
        }
        
      } else {
        console.log('❌ Expected output file NOT found');
      }
      
    } else {
      console.log('❌ Formatting test FAILED');
      console.log(`Error: ${result.error}`);
      
      if (result.data) {
        console.log('📄 Partial data was saved for debugging');
      }
    }
    
  } catch (error) {
    console.log('❌ Test threw an exception:', error.message);
    if (error.message.includes('API key')) {
      console.log('💡 Make sure your ANTHROPIC_API_KEY is set correctly');
    }
  }
  
  console.log('\n🏁 Formatting test completed');
}

// Show usage information
function showUsage() {
  console.log('\n📋 Usage examples:');
  console.log('  npm run test:formatting');
  console.log('  npm run test:formatting -- --org=ecommerce');
  console.log('  npm run test:formatting -- --org=nonprofit');
  console.log('  npm run test:formatting -- --org=corporate');
  console.log('  npm run test:formatting -- --org=portfolio');
  console.log('  npm run test:formatting -- --org=blog');
  console.log('  npm run test:formatting -- --org=saas');
  console.log('  npm run test:formatting -- --org=custom  # Uses environment variables');
  
  console.log('\n🌍 Environment variables for custom config:');
  console.log('  export TEST_ORG_NAME="Your Organization Name"');
  console.log('  export TEST_ORG_TYPE="your organization type"');
  console.log('  export TEST_ORG_PURPOSE="your organization purpose"');
  console.log('');
  
  console.log('💡 Note: If no organization is specified, the context will be');
  console.log('   extracted from the analysis data (if available).');
}

// Check if help was requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
  process.exit(0);
}

// Run the test
testFormattingService().catch(console.error);