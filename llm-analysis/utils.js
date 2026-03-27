const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

/**
 * Validates and cleans up structured data from LLM.
 * 
 * @param {Object} data - The structured data from formatting stage
 * @returns {Object} Validated and cleaned data
 */
function validateStructuredData(data) {
  const errors = [];
  
  // Check required top-level keys
  const requiredKeys = ["scores", "critical_issues", "recommendations", "summary"];
  for (const key of requiredKeys) {
    if (!data[key]) {
      errors.push(`Missing required key: ${key}`);
      data[key] = key === 'summary' ? { text: '', overall_score: 5 } : [];
    }
  }
  
  // Validate scores
  if (data.scores) {
    for (let i = 0; i < data.scores.length; i++) {
      const score = data.scores[i];
      if (!score.category) score.category = `Unnamed Category ${i + 1}`;
      if (typeof score.score !== 'number' || score.score < 1 || score.score > 10) {
        errors.push(`Score ${i} has invalid value: ${score.score}`);
        score.score = 5;
      }
      if (!score.description) score.description = 'No description provided';
    }
  }
  
  // Validate critical issues
  if (data.critical_issues) {
    for (let i = 0; i < data.critical_issues.length; i++) {
      const issue = data.critical_issues[i];
      if (!issue.id) issue.id = i + 1;
      if (!issue.title) issue.title = `Issue ${i + 1}`;
      if (!['High', 'Medium', 'Low'].includes(issue.severity)) {
        issue.severity = 'Medium';
        errors.push(`Issue ${i} has invalid severity: ${issue.severity}`);
      }
      if (!issue.description) issue.description = 'No description provided';
      if (!issue.area) issue.area = 'General';
    }
  }
  
  // Validate recommendations
  if (data.recommendations) {
    for (let i = 0; i < data.recommendations.length; i++) {
      const rec = data.recommendations[i];
      if (!rec.id) rec.id = i + 1;
      if (!rec.title) rec.title = `Recommendation ${i + 1}`;
      if (!['High', 'Medium', 'Low'].includes(rec.impact)) {
        rec.impact = 'Medium';
        errors.push(`Recommendation ${i} has invalid impact: ${rec.impact}`);
      }
      if (!rec.description) rec.description = 'No description provided';
      if (!rec.area) rec.area = 'General';
    }
  }
  
  // Validate summary
  if (data.summary) {
    if (!data.summary.text) data.summary.text = 'No summary provided';
    if (typeof data.summary.overall_score !== 'number' || 
        data.summary.overall_score < 1 || 
        data.summary.overall_score > 10) {
      errors.push(`Overall score has invalid value: ${data.summary.overall_score}`);
      data.summary.overall_score = 5;
    }
    if (!data.summary.priority_action) data.summary.priority_action = 'Review and improve the website to better achieve organizational goals';
  }
  
  // Add validation results to data
  data._validation = {
    valid: errors.length === 0,
    errors: errors
  };
  
  return data;
}

/**
 * Prepares an image for LLM analysis, resizing and compressing as needed
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<Object>} Image data formatted for LLM
 */
async function prepareImageForLLM(imagePath) {
  try {
    // First, get image dimensions
    const metadata = await sharp(imagePath).metadata();
    const { width, height } = metadata;
    
    console.log(`  📏 Image dimensions: ${width}x${height} (${path.basename(imagePath)})`);
    
    // Claude's limits
    const maxDimension = 8000;
    const maxFileSize = 5 * 1024 * 1024; // 5MB in bytes
    
    let processedBuffer;
    let format = 'jpeg'; // We'll use JPEG for better compression
    let quality = 85; // Starting quality
    let resizeAttempts = 0;
    const maxResizeAttempts = 3;
    
    // First pass: resize if needed
    let currentWidth = width;
    let currentHeight = height;
    
    if (width > maxDimension || height > maxDimension) {
      console.log(`  ↩️  Resizing image to fit within ${maxDimension}px limit...`);
      
      // Calculate new dimensions while maintaining aspect ratio
      if (width > height) {
        currentWidth = maxDimension;
        currentHeight = Math.round((height / width) * maxDimension);
      } else {
        currentHeight = maxDimension;
        currentWidth = Math.round((width / height) * maxDimension);
      }
      
      console.log(`  📐 New dimensions: ${currentWidth}x${currentHeight}`);
    }
    
    // Keep trying to reduce file size until it's under 5MB
    while (resizeAttempts < maxResizeAttempts) {
      // Process the image with current settings
      const sharpInstance = sharp(imagePath)
        .resize(currentWidth, currentHeight, {
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: true
        });
      
      // Apply format and quality
      if (format === 'jpeg') {
        sharpInstance.jpeg({ quality, progressive: true });
      } else {
        sharpInstance.png({ compressionLevel: 9, progressive: true });
      }
      
      processedBuffer = await sharpInstance.toBuffer();
      const bufferSize = processedBuffer.length;
      
      console.log(`  💾 File size: ${(bufferSize / 1024 / 1024).toFixed(2)}MB (quality: ${quality}, format: ${format})`);
      
      if (bufferSize <= maxFileSize) {
        console.log(`  ✅ File size within limit`);
        break;
      }
      
      resizeAttempts++;
      
      // If still too large, try different compression strategies
      if (resizeAttempts < maxResizeAttempts) {
        if (quality > 60) {
          // First, reduce quality
          quality -= 15;
          console.log(`  🔻 Reducing quality to ${quality}%`);
        } else if (format === 'jpeg' && currentWidth > 600) {
          // Then reduce dimensions more aggressively
          currentWidth = Math.round(currentWidth * 0.8);
          currentHeight = Math.round(currentHeight * 0.8);
          quality = 85; // Reset quality for smaller image
          console.log(`  📏 Further reducing dimensions to ${currentWidth}x${currentHeight}`);
        } else {
          // Last resort: switch to PNG with high compression
          format = 'png';
          quality = 100; // PNG doesn't use quality param
          console.log(`  🔄 Switching to PNG format with maximum compression`);
        }
      }
    }
    
    if (processedBuffer.length > maxFileSize) {
      console.warn(`  ⚠️  Warning: Could not reduce image size below 5MB limit. Final size: ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      console.warn(`  ⚠️  This image may be rejected by the API`);
    }
    
    // Convert to base64
    const base64Data = processedBuffer.toString('base64');
    
    // Use the format we ended up with
    const mediaType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    
    return {
      data: base64Data,
      mediaType: mediaType,
      filename: path.basename(imagePath),
      originalSize: metadata.size,
      processedSize: processedBuffer.length,
      dimensions: {
        original: { width, height },
        processed: { width: currentWidth, height: currentHeight }
      }
    };
  } catch (error) {
    console.error(`Error preparing image ${imagePath}:`, error);
    throw error;
  }
}

/**
 * Processes raw LLM analysis results into structured format
 * @param {Object} rawAnalysis - Raw analysis from LLM
 * @param {Array} screenshots - Screenshot data
 * @param {Array} lighthouseData - Lighthouse report data
 * @returns {Promise<Object>} Structured analysis results
 */
async function processAnalysisResults(rawAnalysis, screenshots, lighthouseData) {
  try {
    // Structure the data for easier consumption
    const processed = {
      timestamp: new Date().toISOString(),
      summary: {
        overview: rawAnalysis.overview || '',
        technicalSummary: rawAnalysis.technicalSummary || '',
        keyFindings: extractKeyFindings(rawAnalysis),
        averageScores: calculateAverageScores(lighthouseData)
      },
      pages: [],
      recommendations: {
        priority: extractPriorityRecommendations(rawAnalysis.recommendations),
        technical: extractTechnicalRecommendations(rawAnalysis.recommendations),
        ux: extractUXRecommendations(rawAnalysis.recommendations),
        performance: extractPerformanceRecommendations(rawAnalysis.recommendations)
      },
      metadata: {
        totalPages: screenshots.length,
        analysisProvider: rawAnalysis.provider,
        analysisModel: rawAnalysis.model,
        generatedAt: rawAnalysis.timestamp
      }
    };
    
    // Process each page analysis
    for (let i = 0; i < rawAnalysis.pageAnalyses.length; i++) {
      const pageAnalysis = rawAnalysis.pageAnalyses[i];
      const screenshot = screenshots[i];
      const lighthouse = lighthouseData[i];
      
      processed.pages.push({
        url: screenshot?.url || lighthouse?.url,
        analysis: pageAnalysis,
        screenshots: screenshot ? [{
          filename: screenshot.filename,
          path: screenshot.path
        }] : [],
        lighthouse: lighthouse ? {
          scores: lighthouse.data.scores,
          metrics: lighthouse.data.metrics,
          coreWebVitals: lighthouse.data.coreWebVitals
        } : null,
        findings: extractPageFindings(pageAnalysis),
        suggestions: extractPageSuggestions(pageAnalysis)
      });
    }
    
    return processed;
  } catch (error) {
    console.error('Error processing analysis results:', error);
    throw error;
  }
}

/**
 * Calculate average lighthouse scores across all pages
 */
function calculateAverageScores(lighthouseData) {
  if (!lighthouseData || lighthouseData.length === 0) return null;
  
  const scores = {
    performance: 0,
    accessibility: 0,
    bestPractices: 0,
    seo: 0
  };
  
  let count = 0;
  
  lighthouseData.forEach(item => {
    if (item.data && item.data.scores) {
      if (item.data.scores.performance) scores.performance += item.data.scores.performance.score;
      if (item.data.scores.accessibility) scores.accessibility += item.data.scores.accessibility.score;
      if (item.data.scores['best-practices']) scores.bestPractices += item.data.scores['best-practices'].score;
      if (item.data.scores.seo) scores.seo += item.data.scores.seo.score;
      count++;
    }
  });
  
  if (count === 0) return null;
  
  return {
    performance: (scores.performance / count * 100).toFixed(1),
    accessibility: (scores.accessibility / count * 100).toFixed(1),
    bestPractices: (scores.bestPractices / count * 100).toFixed(1),
    seo: (scores.seo / count * 100).toFixed(1)
  };
}

/**
 * Extract key findings from raw analysis
 */
function extractKeyFindings(rawAnalysis) {
  // This would parse the LLM output to extract key findings
  // For now, we'll return a basic structure
  return {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: []
  };
}

/**
 * Extract recommendations by category
 */
function extractPriorityRecommendations(recommendations) {
  if (!recommendations) return [];
  
  // Parse LLM output to extract priority recommendations
  // This is a simplified version - you'd want more sophisticated parsing
  const lines = recommendations.split('\n');
  return lines
    .filter(line => line.includes('Priority') || line.includes('High') || line.includes('Critical'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function extractTechnicalRecommendations(recommendations) {
  if (!recommendations) return [];
  
  const lines = recommendations.split('\n');
  return lines
    .filter(line => line.includes('Technical') || line.includes('Code') || line.includes('Performance'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function extractUXRecommendations(recommendations) {
  if (!recommendations) return [];
  
  const lines = recommendations.split('\n');
  return lines
    .filter(line => line.includes('UX') || line.includes('User') || line.includes('Design'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function extractPerformanceRecommendations(recommendations) {
  if (!recommendations) return [];
  
  const lines = recommendations.split('\n');
  return lines
    .filter(line => line.includes('Performance') || line.includes('Speed') || line.includes('Loading'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Extract findings from individual page analysis
 */
function extractPageFindings(pageAnalysis) {
  if (!pageAnalysis) return [];
  
  // Parse the analysis to extract specific findings
  const lines = pageAnalysis.split('\n');
  return lines
    .filter(line => line.startsWith('-') || line.startsWith('•') || line.startsWith('*'))
    .map(line => line.replace(/^[-•*]\s*/, '').trim())
    .filter(line => line.length > 0);
}

/**
 * Extract suggestions from individual page analysis
 */
function extractPageSuggestions(pageAnalysis) {
  if (!pageAnalysis) return [];
  
  // Parse the analysis to extract suggestions
  const lines = pageAnalysis.split('\n');
  return lines
    .filter(line => line.includes('suggest') || line.includes('recommend') || line.includes('improve'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

module.exports = {
  prepareImageForLLM,
  processAnalysisResults,
  calculateAverageScores,
  extractKeyFindings,
  extractPriorityRecommendations,
  extractTechnicalRecommendations,
  extractUXRecommendations,
  extractPerformanceRecommendations,
  extractPageFindings,
  extractPageSuggestions,
  validateStructuredData
};