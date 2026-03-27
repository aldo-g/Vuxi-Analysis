function getScoringDefinitions() {
  return `
    SCORING RUBRIC:
    1-3: Poor - Significantly hinders user experience and requires immediate attention
    4-5: Below Average - Has notable issues affecting effectiveness
    6-7: Average - Functional but with clear opportunities for improvement
    8-9: Good - Effectively supports goals with minor refinements needed
    10: Excellent - Exemplary implementation with no significant issues

    BASELINE EXPECTATIONS:
    - Good technical performance (fast loading, mobile responsiveness) is STANDARD and should not be praised as exceptional
    - Focus on content relevance, user value, and organizational goal alignment over technical implementation
    - Incomplete, placeholder, or outdated content should be flagged and penalized
    - Images should be evaluated for content relevance and support of organizational goals, NOT technical quality
  `;
}

function getEvaluationGuidelines(orgContext) {
  return `
    CRITICAL EVALUATION GUIDELINES:
    
    ORGANIZATIONAL CONTEXT: This is a ${orgContext.org_type} whose website aims ${orgContext.org_purpose}
    
    RED FLAGS TO ALWAYS IDENTIFY:
    - Placeholder text (Lorem ipsum, "Coming soon", "Under construction")
    - Outdated information (old dates, expired events, obsolete pricing)
    - Missing essential information for decision-making
    - Content that doesn't match the page's intended purpose
    - Broken or obviously placeholder links/buttons
    - Images that don't support the organization's message or page purpose
    
    BASELINE VS EXCEPTIONAL:
    - Technical excellence (fast loading, responsive design) = BASELINE EXPECTATION (score 6-7)
    - Only mention technical performance if it's notably poor (score 1-5) or exceptionally optimized (score 9-10)
    - Focus analysis on content value, user journey, and goal achievement
    
    CONTENT RELEVANCE PRIORITY:
    - Does content directly support the organization's purpose?
    - Is information complete and actionable for users?
    - Does the page fulfill its role in the user journey?
    - Are there logical next steps for users?
  `;
}

function getExampleSection() {
  return `
    EXAMPLES OF PROPERLY FORMATTED RESPONSES:
    
    CRITICAL FLAWS EXAMPLE:
    1. Incomplete Service Information (Severity: High) - The main service descriptions contain placeholder text and lack pricing or contact details, preventing users from taking action toward the organization's goal of generating leads.
    
    RECOMMENDATIONS EXAMPLE:
    1. Complete Content Development (Impact: High) - Replace placeholder content with specific, actionable information that guides users toward engagement with the organization's services.
    
    SCORING EXAMPLE:
    CONTENT QUALITY (Score: 4/10)
    - Service descriptions lack specific details needed for decision-making
    - Multiple sections contain "Lorem ipsum" placeholder text
    - Pricing information is completely absent, hindering lead generation
    - Content doesn't address common user questions about services
    - EVIDENCE: The "Our Services" section displays "Content coming soon" instead of actual service details, and the pricing page shows placeholder pricing tables.
  `;
}

function createAnalysisPrompt(pageType, context, sections) {
  let prompt = `You are a UX/UI expert analyzing a ${pageType} for ${context.org_name || 'this organization'}, a ${context.org_type || 'organization'}.
    
    WEBSITE PURPOSE: ${context.org_purpose || 'to achieve its business goals and serve its users effectively'}
    
    ${getScoringDefinitions()}
    
    ${getEvaluationGuidelines(context)}
    
    Provide a detailed, critical analysis focusing on how well this supports the organization's goals and serves users effectively.\n\n`;
    
    // Add each section
    sections.forEach(section => {
      prompt += `${section.number}. ${section.name} (Score: ?/10)\n`;
      section.questions.forEach(question => {
        prompt += `   - ${question}\n`;
      });
      prompt += `   - EVIDENCE: Cite specific examples from the ${pageType}\n\n`;
    });
    
    // Add standard sections at the end
    prompt += `
    CRITICAL FLAWS:
    - Identify the 3 most significant problems that hinder the organization's goals (numbered)
    - Rate each issue's severity (High/Medium/Low) based on impact on user success and organizational objectives
    - For each flaw, provide a brief "How to Fix" section detailing specific steps to resolve it
    - Format as: "1. [Issue title] (Severity: High) - [Description focusing on user/business impact] How to Fix: [Specific actionable steps]"

    ACTIONABLE RECOMMENDATIONS:
    - Provide 5 specific, prioritized recommendations that will improve goal achievement (numbered)
    - Rate each recommendation's impact (High/Medium/Low) on organizational success
    - For each recommendation, describe the primary "Benefit" in terms of user value and business outcomes
    - Format as: "1. [Recommendation] (Impact: High) - [Implementation details] Benefit: [Specific value to users and organization]"
    
    SUMMARY:
    - Overall effectiveness score (1-10) based on goal achievement potential
    - 2-3 sentence summary highlighting the biggest barriers to success and key opportunities
    - Single highest-priority action that would most improve organizational goal achievement
    `;
    
    return prompt;
}

function getAnalysisPrompt(type, data) {
  const context = {
    org_name: data.context?.org_name || 'the organization',
    org_type: data.context?.org_type || 'organization',
    org_purpose: data.context?.org_purpose || 'to achieve its business goals and serve its users effectively'
  };

  switch (type) {
    case 'comprehensive_overview':
      return `You are a senior UX/UI consultant providing a comprehensive final analysis of ${context.org_name}, a ${context.org_type}.

      WEBSITE PURPOSE: ${context.org_purpose}

      ${getEvaluationGuidelines(context)}

      Please format your response as a Markdown document.
      The main sections of your report should be H2 headings (e.g., ## Section Title).
      Sub-sections should use H3 headings (e.g., ### Subsection Title), and bullet points for lists.

      This is the final step of our analysis. You now have access to:
      1. All website screenshots
      2. Detailed individual page analyses
      3. Technical performance summary
      4. All Lighthouse performance data

      INDIVIDUAL PAGE ANALYSES:
      ${data.pageAnalyses.map(page => `
      === ${page.url} ===
      ${page.analysis}
      `).join('\n\n')}

      TECHNICAL SUMMARY:
      ${data.technicalSummary}

      LIGHTHOUSE SCORES SUMMARY:
      ${data.pages.map(page => `
      - ${page.url}
        Performance: ${page.lighthouseScores?.performance ? (page.lighthouseScores.performance * 100).toFixed(1) + '%' : 'N/A'}
        Accessibility: ${page.lighthouseScores?.accessibility ? (page.lighthouseScores.accessibility * 100).toFixed(1) + '%' : 'N/A'}
        Best Practices: ${page.lighthouseScores?.bestPractices ? (page.lighthouseScores.bestPractices * 100).toFixed(1) + '%' : 'N/A'}
        SEO: ${page.lighthouseScores?.seo ? (page.lighthouseScores.seo * 100).toFixed(1) + '%' : 'N/A'}
      `).join('\n')}

      Based on all this comprehensive data, provide the following sections using the specified Markdown heading levels:

      ## EXECUTIVE SUMMARY
         - Provide an overall assessment of the website's effectiveness (Score: ?/10) in achieving: ${context.org_purpose}
         - Focus on content completeness, user value delivery, and conversion potential
         - Summarize the biggest barriers to organizational success and highest-impact opportunities
         - NOTE: Do not praise basic technical performance unless exceptionally poor or outstanding

      ## KEY FINDINGS
         ### Top 3 content and user experience strengths that support organizational goals
           - Strength 1: (Focus on content value, user journey, goal alignment)
           - Strength 2: (Focus on trust building, clarity, actionability)
           - Strength 3: (Focus on conversion support, user guidance)
         ### Top 5 critical barriers to organizational success
           - Issue 1 (Severity: High/Medium/Low) - (Focus on content gaps, user friction, goal misalignment). How to Fix: (Specific content/UX improvements).
           - Issue 2 (Severity: High/Medium/Low) - (Description). How to Fix: (Details).
           - ...and so on for up to 5 issues prioritized by impact on organizational goals.

      ## STRATEGIC RECOMMENDATIONS
         ### Content & messaging improvements (Priority 1)
           - Recommendation 1 (Impact: High/Medium/Low, Effort: High/Medium/Low) - (Focus on content completion, value clarity, user guidance).
           - ...
         ### User experience & conversion optimizations (Priority 2)  
           - Recommendation 1 (Impact: High/Medium/Low, Effort: High/Medium/Low) - (Focus on user journey, friction reduction, trust building).
           - ...
         ### Trust & credibility enhancements (Priority 3)
           - Recommendation 1 (Impact: High/Medium/Low, Effort: High/Medium/Low) - (Focus on social proof, professional presentation, contact information).
           - ...
         ### Technical & accessibility improvements (Priority 4)
           - (Only include if technical issues significantly impact user experience or organizational goals)
           - ...

      ## ORGANIZATIONAL ALIGNMENT ASSESSMENT
         ### How effectively the website supports: ${context.org_purpose}
           - (Your assessment focused on content, messaging, and user journey effectiveness)
         ### Content gaps preventing goal achievement
           - (Missing information, incomplete sections, unclear value propositions)
         ### Trust and credibility factors impacting conversions
           - (Professional presentation, social proof, contact accessibility)

      ## IMPLEMENTATION ROADMAP
         ### Immediate content fixes (1-2 weeks)
           - Complete any placeholder or unfinished content
           - Add missing essential information for decision-making
           - Fix broken or unclear calls-to-action
         ### User experience improvements (1-2 months)
           - Enhance user journey and reduce friction points
           - Improve content organization and clarity
           - Add trust signals and social proof
         ### Strategic enhancements (3-6 months)
           - Comprehensive content strategy alignment
           - Advanced conversion optimization
           - Long-term user engagement features

      REMEMBER: Focus on content value, user success, and organizational goal achievement. Only mention technical performance if it's notably poor or exceptional.
      `;

    case 'page':
      const pageSections = [
        {
          number: 1,
          name: "FIRST IMPRESSION & CLARITY",
          questions: [
            "How quickly can a visitor understand what this page offers and why it matters to them?",
            "Does the visual hierarchy effectively guide users to the most important information first?",
            "Is the page's value proposition immediately clear and compelling for the organization's target audience?",
            "Are there any placeholder, incomplete, or obviously unfinished elements that undermine credibility?"
          ]
        },
        {
          number: 2,
          name: "GOAL ALIGNMENT & CONTENT RELEVANCE",
          questions: [
            `How effectively does this page's content advance the organization's purpose: ${context.org_purpose}?`,
            "Is all content directly relevant to this page's role in the user journey?",
            "Does the information provided enable users to make informed decisions or take meaningful action?",
            "Are there clear, logical next steps that align with organizational goals?",
            "Is any content outdated, irrelevant, or misaligned with the page's intended purpose?"
          ]
        },
        {
          number: 3,
          name: "VISUAL DESIGN & CONTENT PRESENTATION",
          questions: [
            "How effectively does the visual design support content comprehension and goal achievement?",
            "Do images and visuals directly support the organization's message and page purpose (ignore technical image quality)?",
            "Does the layout create clear information hierarchy that guides users through key messages?",
            "Is the design professional and trustworthy for this organization type?",
            "Are visual elements purposeful rather than decorative?"
          ]
        },
        {
          number: 4,
          name: "CONTENT COMPLETENESS & QUALITY",
          questions: [
            "Is all essential information present and complete (no placeholder or 'coming soon' content)?",
            "Does the content answer the questions users likely have when visiting this page?",
            "Is the information current, accurate, and actionable?",
            "Does the content demonstrate expertise and build trust in the organization?",
            "Are there gaps in information that prevent users from moving forward in their journey?"
          ]
        },
        {
          number: 5,
          name: "USER JOURNEY & DECISION SUPPORT",
          questions: [
            "Does this page provide clear pathways for users to achieve their goals?",
            "Are potential user concerns or objections addressed within the content?",
            "Is there sufficient information for users to feel confident taking the next step?",
            "Are interactive elements intuitive and functional for their intended purpose?",
            "Does the page reduce friction in the user's decision-making process?"
          ]
        },
        {
          number: 6,
          name: "CONVERSION & ENGAGEMENT OPTIMIZATION",
          questions: [
            "How effectively does this page guide users toward desired organizational outcomes?",
            "Are calls-to-action clear, compelling, and appropriately positioned for the page context?",
            "Does the page build sufficient trust and credibility to encourage user action?",
            "Are there unnecessary barriers or distractions that could prevent conversion?",
            "Does the page create appropriate urgency or motivation for user engagement?"
          ]
        },
        {
          number: 7,
          name: "TECHNICAL EXECUTION & ACCESSIBILITY",
          questions: [
            "Are there any technical issues that significantly impact user experience or goal achievement?",
            "Would users with different abilities be able to access and use this page effectively?",
            "Are there broken links, missing functionality, or obvious technical problems?",
            "NOTE: Only highlight technical performance if notably poor (impacting UX) or exceptionally good",
            "Focus on accessibility and functionality rather than basic responsive design"
          ]
        }
      ];

      let pagePrompt = createAnalysisPrompt(`${data.page_type || 'webpage'}`, context, pageSections);
      
      pagePrompt += `
      URL: ${data.url}
      
      Lighthouse Performance Context (only mention if scores are notably poor <60% or exceptional >95%):
      ${data.lighthouse ? formatLighthouseMetrics(data.lighthouse) : 'No lighthouse data available'}
      
      PAGE ROLE ANALYSIS:
      - Considering this is a ${data.page_type || 'webpage'}, how completely does it fulfill its specific purpose in advancing ${context.org_purpose}?
      - What essential information or functionality is missing that users would expect on this type of page?
      - How effectively does this page connect users to logical next steps in their journey?
      - Does the content demonstrate value and build trust appropriate for this stage of user engagement?
      `;
      
      pagePrompt += getExampleSection();
      return pagePrompt;

    default:
      return 'Please analyze the provided website data and screenshots focusing on content completeness, user value, and organizational goal achievement.';
  }
}

function formatLighthouseMetrics(lighthouse) {
  if (!lighthouse.metrics) return 'No metrics available';

  return `
  Core Web Vitals:
  - First Contentful Paint: ${lighthouse.metrics.firstContentfulPaint || 'N/A'}ms
  - Largest Contentful Paint: ${lighthouse.metrics.largestContentfulPaint || 'N/A'}ms
  - Total Blocking Time: ${lighthouse.metrics.totalBlockingTime || 'N/A'}ms
  - Cumulative Layout Shift: ${lighthouse.metrics.cumulativeLayoutShift || 'N/A'}
  - Speed Index: ${lighthouse.metrics.speedIndex || 'N/A'}

  Overall Scores:
  - Performance: ${lighthouse.scores?.performance ? (lighthouse.scores.performance.score * 100).toFixed(1) + '%' : 'N/A'}
  - Accessibility: ${lighthouse.scores?.accessibility ? (lighthouse.scores.accessibility.score * 100).toFixed(1) + '%' : 'N/A'}
  - Best Practices: ${lighthouse.scores?.['best-practices'] ? (lighthouse.scores['best-practices'].score * 100).toFixed(1) + '%' : 'N/A'}
  - SEO: ${lighthouse.scores?.seo ? (lighthouse.scores.seo.score * 100).toFixed(1) + '%' : 'N/A'}
  `;
}

module.exports = {
  getAnalysisPrompt,
  getScoringDefinitions,
  getExampleSection,
  createAnalysisPrompt,
  formatLighthouseMetrics
};