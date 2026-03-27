function getScoringDefinitions() {
    return `
      SCORING RUBRIC:
      1-3: Poor - Significantly hinders user experience and requires immediate attention
      4-5: Below Average - Has notable issues affecting effectiveness
      6-7: Average - Functional but with clear opportunities for improvement
      8-9: Good - Effectively supports goals with minor refinements needed
      10: Excellent - Exemplary implementation with no significant issues
    `;
  }
  
  function getTechnicalPrompt(type, data) {
    const basePrompt = `You are a technical UX/UI expert conducting a detailed technical analysis.
    
    ${getScoringDefinitions()}
    
    Provide a comprehensive technical assessment focusing on measurable metrics and actionable insights.\n\n`;
  
    switch (type) {
      case 'summary':
        return basePrompt + `Generate a technical summary of website performance based on Lighthouse data:
  
        ${data.lighthouseData.map(page => `
        Page: ${page.url}
        ${page.lighthouse ? formatTechnicalMetrics(page.lighthouse) : 'No data available'}
        `).join('\n---\n')}
  
        Please provide:
        1. **Performance Overview**
           - Average Core Web Vitals across all pages
           - Common performance bottlenecks
           - Overall performance grade
  
        2. **Technical Findings**
           - Resource loading issues
           - JavaScript and CSS optimization opportunities
           - Image optimization recommendations
           - Caching strategies needed
  
        3. **Implementation Priorities**
           - Quick wins (easy to implement, high impact)
           - Medium-term improvements
           - Long-term architectural changes
  
        Format as a technical report with metrics and specific recommendations.`;
  
      case 'detailed':
        return basePrompt + `Provide a detailed technical analysis of the website's performance:
  
        Data summary:
        - Total pages analyzed: ${data.lighthouseData.length}
        - Average performance score: ${calculateAveragePerformance(data.lighthouseData)}%
  
        Key metrics to analyze:
        ${data.lighthouseData.map(page => `
        ${page.url}:
        ${formatDetailedMetrics(page.lighthouse)}
        `).join('\n')}
  
        Focus on:
        1. **Core Web Vitals Analysis**
           - LCP (Largest Contentful Paint) trends
           - FID/TBT (First Input Delay/Total Blocking Time) patterns
           - CLS (Cumulative Layout Shift) issues
  
        2. **Resource Optimization**
           - Render-blocking resources
           - Unused JavaScript/CSS
           - Image optimization opportunities
           - Font loading strategies
  
        3. **Network Performance**
           - Server response times
           - Resource compression
           - HTTP/2 adoption
           - CDN usage
  
        4. **Code Quality Issues**
           - JavaScript execution time
           - DOM size and complexity
           - CSS efficiency
           - Third-party script impact
  
        Provide specific, actionable recommendations with implementation details.`;
  
      case 'architecture':
        return basePrompt + `Analyze the technical architecture of this website:
  
        Performance data across ${data.lighthouseData.length} pages:
        ${data.lighthouseData.map(page => formatArchitectureData(page)).join('\n')}
  
        Please assess:
        1. **Frontend Architecture**
           - Framework/library usage patterns
           - Build optimization
           - Component structure efficiency
           - State management impact
  
        2. **Loading Strategy**
           - Critical path analysis
           - Lazy loading implementation
           - Resource prioritization
           - Code splitting effectiveness
  
        3. **Infrastructure**
           - Server response patterns
           - CDN configuration
           - Caching strategies
           - HTTP/2 or HTTP/3 usage
  
        4. **Third-party Services**
           - Analytics impact
           - Marketing tools overhead
           - Social media integrations
           - External API dependencies
  
        Provide recommendations for architectural improvements with complexity estimates.`;
  
      case 'critical_issues':
        return basePrompt + `Identify and prioritize critical technical issues:
  
        Technical data for ${data.lighthouseData.length} pages
        Average performance score: ${calculateAveragePerformance(data.lighthouseData)}%
  
        Please provide:
        1. **Critical Performance Issues**
           - Issues blocking good Core Web Vitals scores
           - Major render-blocking resources
           - Severe JavaScript bottlenecks
           - Critical accessibility violations
  
        2. **High-Impact Quick Fixes**
           - Image optimization opportunities
           - Simple caching improvements
           - Easy-to-implement code optimizations
           - Low-effort accessibility wins
  
        3. **Priority Matrix**
           - Effort vs. Impact matrix for all recommendations
           - ROI estimates for each fix
           - Implementation roadmap (1 week, 1 month, 1 quarter)
  
        Format as:
        - Issue: [Description] (Severity: High/Medium/Low)
        - Solution: [Specific steps]
        - Impact: [Expected improvement]
        - Effort: [Time estimate]`;
  
      default:
        return basePrompt + 'Please provide a technical analysis of the website data.';
    }
  }
  
  function formatTechnicalMetrics(lighthouse) {
    if (!lighthouse || !lighthouse.metrics) return 'No technical metrics available';
  
    const { metrics, coreWebVitals, scores } = lighthouse;
  
    return `
    Core Web Vitals:
    - LCP: ${coreWebVitals?.lcp?.displayValue || 'N/A'} (${coreWebVitals?.lcp?.score ? 'Score: ' + (coreWebVitals.lcp.score * 100).toFixed(0) + '%' : 'N/A'})
    - FID: ${coreWebVitals?.fid?.displayValue || 'N/A'} (${coreWebVitals?.fid?.score ? 'Score: ' + (coreWebVitals.fid.score * 100).toFixed(0) + '%' : 'N/A'})
    - CLS: ${coreWebVitals?.cls?.displayValue || 'N/A'} (${coreWebVitals?.cls?.score ? 'Score: ' + (coreWebVitals.cls.score * 100).toFixed(0) + '%' : 'N/A'})
  
    Performance Metrics:
    - First Contentful Paint: ${metrics.firstContentfulPaint || 'N/A'}ms
    - Time to Interactive: ${metrics.interactive || 'N/A'}ms
    - Total Blocking Time: ${metrics.totalBlockingTime || 'N/A'}ms
    - Speed Index: ${metrics.speedIndex || 'N/A'}
  
    Performance Score: ${scores?.performance ? (scores.performance.score * 100).toFixed(1) + '%' : 'N/A'}
  
    Additional Technical Data:
    - Accessibility Score: ${scores?.accessibility ? (scores.accessibility.score * 100).toFixed(1) + '%' : 'N/A'}
    - Best Practices Score: ${scores?.['best-practices'] ? (scores['best-practices'].score * 100).toFixed(1) + '%' : 'N/A'}
    - SEO Score: ${scores?.seo ? (scores.seo.score * 100).toFixed(1) + '%' : 'N/A'}
    `;
  }
  
  function formatDetailedMetrics(lighthouse) {
    if (!lighthouse) return 'No data available';
  
    const { audits } = lighthouse;
  
    return `
      Performance Breakdown:
      - Server Response Time: ${audits?.['server-response-time']?.displayValue || 'N/A'}
      - Render Blocking Resources: ${audits?.['render-blocking-resources']?.details?.items?.length || 0} found
      - Unused CSS: ${audits?.['unused-css-rules']?.details?.overallSavingsMs || 0}ms potential savings
      - Unused JavaScript: ${audits?.['unused-javascript']?.details?.overallSavingsMs || 0}ms potential savings
      - Image Optimization: ${audits?.['uses-optimized-images']?.score === 1 ? 'Good' : 'Needs improvement'}
      - Text Compression: ${audits?.['uses-text-compression']?.score === 1 ? 'Enabled' : 'Not enabled'}
    `;
  }
  
  function formatArchitectureData(page) {
    if (!page.lighthouse) return `${page.url}: No data available`;
  
    const { audits } = page.lighthouse;
  
    return `
    ${page.url}:
      - Framework detection: ${audits?.['prioritize-lcp-image']?.details?.items?.[0]?.node?.snippet || 'Unknown'}
      - Critical request chains: ${audits?.['critical-request-chains']?.details?.chains ? Object.keys(audits['critical-request-chains'].details.chains).length : 0}
      - DOM size: ${audits?.['dom-size']?.displayValue || 'N/A'}
      - Main thread work: ${audits?.['mainthread-work-breakdown']?.displayValue || 'N/A'}
    `;
  }
  
  function calculateAveragePerformance(lighthouseData) {
    const scores = lighthouseData
      .filter(item => item.lighthouse?.scores?.performance)
      .map(item => item.lighthouse.scores.performance.score * 100);
  
    if (scores.length === 0) return 'N/A';
  
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    return average.toFixed(1);
  }
  
  module.exports = {
    getTechnicalPrompt,
    getScoringDefinitions,
    formatTechnicalMetrics,
    formatDetailedMetrics,
    formatArchitectureData,
    calculateAveragePerformance
  };