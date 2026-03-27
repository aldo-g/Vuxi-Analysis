/**
 * Formatting prompts for individual pages and overall summary
 */

function getFormattingPrompts(orgContext = null) {
  // Default organization context if not provided
  const defaultOrgContext = {
    org_name: 'the organization',
    org_type: 'organization',
    org_purpose: 'to achieve its business goals and serve its users effectively'
  };
  
  const context = orgContext || defaultOrgContext;
  
  return {
    individualPage: (pageAnalysis) => `
You are an expert at structuring website analysis data into PERFECT, VALID JSON.
Extract key information from the following raw page analysis and structure it according to the JSON format specified below.

ORGANIZATION CONTEXT:
- Name: ${context.org_name}
- Type: ${context.org_type}
- Purpose: ${context.org_purpose}

PAGE ANALYSIS TO FORMAT:
URL: ${pageAnalysis.url}
Raw Analysis Content:
${"```markdown\n" + pageAnalysis.analysis + "\n```"}

You MUST return ONLY a single, valid JSON object. NO additional text, NO explanations, NO markdown formatting like \`\`\`json.
The entire response must be the JSON object itself.

THE EXACT JSON STRUCTURE REQUIRED:
{
  "page_type": "Infer a concise page type (e.g., Homepage, Contact Page, Product Detail, Article Page) based on URL and content.",
  "title": "Create a descriptive page title based on its content (e.g., 'Product Catalog', 'Contact Information', 'Service Overview').",
  "overall_score": ${"`/* (number 1-10) Extract or infer the overall score for this page from the raw analysis. Default to 5 if not explicitly found. */`"},
  "overall_explanation": "Provide a brief (1-2 sentences) explanation for the overall_score. Mention what helped the score and what hurt it. If no explicit explanation, summarize key positive and negative themes.",
  "sections": [
    {
      "name": "first_impression_clarity",
      "title": "First Impression & Clarity",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": [
        "Extract key positive/negative bullet point 1 for this section.",
        "Extract key positive/negative bullet point 2 for this section."
      ],
      "evidence": "Cite specific evidence from the raw analysis for this section (1-2 sentences).",
      "score_explanation": "What helped the score in this section. What hurt the score in this section."
    },
    {
      "name": "goal_alignment",
      "title": "Goal Alignment",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for goal alignment.",
      "score_explanation": "What helped/hurt score."
    },
    {
      "name": "visual_design",
      "title": "Visual Design",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for visual design.",
      "score_explanation": "What helped/hurt score."
    },
    {
      "name": "content_quality",
      "title": "Content Quality",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for content quality.",
      "score_explanation": "What helped/hurt score."
    },
    {
      "name": "usability_accessibility",
      "title": "Usability & Accessibility",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for usability & accessibility.",
      "score_explanation": "What helped/hurt score."
    },
    {
      "name": "conversion_optimization",
      "title": "Conversion Optimization",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for conversion optimization.",
      "score_explanation": "What helped/hurt score."
    },
    {
      "name": "technical_execution",
      "title": "Technical Execution",
      "score": ${"`/* (number 1-10) Score for this section. Default to 5. */`"},
      "summary": "Summarize overall performance in this area (1-2 sentences).",
      "points": ["Point 1", "Point 2"],
      "evidence": "Evidence for technical execution.",
      "score_explanation": "What helped/hurt score."
    }
  ],
  "key_issues": [
    // IMPORTANT: Extract 0 to 8 significant key issues from the 'CRITICAL FLAWS' section of the raw analysis.
    // Each issue should be an object: { "issue": "Issue description including severity if mentioned.", "how_to_fix": "Fix details or 'Refer to analysis'." }
    // If no significant issues are found, provide an empty array: [].
    // Example of one issue (if present):
    // { "issue": "Missing Clear Call-to-Action (Severity: High)", "how_to_fix": "Add prominent, visually distinct action buttons aligned with organizational goals." }
  ],
  "recommendations": [
    // IMPORTANT: Extract 0 to 8 significant actionable recommendations from the 'ACTIONABLE RECOMMENDATIONS' section of the raw analysis.
    // Each recommendation should be an object: { "recommendation": "Recommendation description including impact if mentioned.", "benefit": "Benefit details or 'Improves user experience.'." }
    // If no specific recommendations are warranted, provide an empty array: [].
    // Example of one recommendation (if present):
    // { "recommendation": "Improve Navigation Structure (Impact: High)", "benefit": "Creates clearer user pathways and reduces confusion for visitors." }
  ],
  "summary": "Provide a 2-3 sentence overall summary of this specific page's analysis, highlighting its main strengths and weaknesses in relation to ${context.org_purpose}."
}

IMPORTANT RULES FOR JSON OUTPUT:
- Adhere strictly to the JSON structure above.
- All scores MUST be numbers between 1 and 10.
- "key_issues" MUST be an array of 0 to 8 objects. Each object MUST have an "issue" (string) and "how_to_fix" (string) property. If no significant issues are found, provide an empty array: [].
- "recommendations" MUST be an array of 0 to 8 objects. Each object MUST have a "recommendation" (string) and "benefit" (string) property. If no significant recommendations are found, provide an empty array: [].
- All other string values should be concise and directly extracted or summarized from the raw analysis.
- Consider the organization context (${context.org_name}, ${context.org_type}, ${context.org_purpose}) when formatting content.
- If information for a field is not clearly present in the raw analysis, provide a sensible default or a note like "Not specified in analysis."
- DO NOT use markdown (e.g., no \`\`\`, no \`*\`, no \`-\` for lists inside strings where not appropriate for the final text).
- Ensure all strings are properly escaped for JSON if they contain special characters like quotes or newlines.
- The final output MUST start with \`{\` and end with \`}\` and be parseable by JSON.parse().
`,

    overallSummary: (rawAnalysisData, pageAnalyses) => `
You are an expert at creating concise, structured executive summaries in PERFECT, VALID JSON.
Based on the provided full analysis data and individual page summaries, generate an overall summary.
The "detailed_markdown_content" field MUST contain the ENTIRE RAW MARKDOWN of the "Overall LLM Analysis Content" provided below, verbatim. Newlines within this markdown MUST be escaped as \\n.

ORGANIZATION CONTEXT:
- Name: ${context.org_name}
- Type: ${context.org_type}  
- Purpose: ${context.org_purpose}

Overall LLM Analysis Content (raw markdown to be included in detailed_markdown_content):
${"```markdown\n" + rawAnalysisData.overview + "\n```"}

You MUST return ONLY a single, valid JSON object. NO additional text, NO explanations, NO markdown formatting like \`\`\`json.
The entire response must be the JSON object itself.

THE EXACT JSON STRUCTURE REQUIRED:
{
  "executive_summary": "Craft a 2-3 paragraph executive summary. Synthesize key findings, overall website effectiveness in achieving the purpose of ${context.org_purpose}, and the most critical areas for improvement across the entire website. This should be a concise summary derived from the 'Overall LLM Analysis Content'.",
  "overall_score": ${"`/* (number 1-10) Extract or infer an average overall website score from the 'Overall LLM Analysis Content'. Default to 6 if not explicitly found. */`"},
  "site_score_explanation": "Provide a concise 1-2 sentence explanation for the 'overall_score' of the entire site, derived from the 'Overall LLM Analysis Content'. Focus on the primary reasons behind this score, highlighting key factors. Example: 'The site received this score due to its strong visual design but was held back by unclear navigation and weak calls to action.'",
  "total_pages_analyzed": ${pageAnalyses.length},
  "most_critical_issues": [
    "Identify and list up to 5 site-wide critical issues by summarizing them from the 'Overall LLM Analysis Content'. Focus on issues that most impact ${context.org_purpose}. Example: 'Inconsistent navigation across multiple key pages.'"
  ],
  "top_recommendations": [
    "Identify and list up to 5 high-priority, site-wide recommendations by summarizing them from the 'Overall LLM Analysis Content'. Focus on recommendations that best support ${context.org_purpose}. Example: 'Standardize call-to-action button design across all pages.'"
  ],
  "key_strengths": [
    "Identify and list up to 3 key strengths of the website by summarizing them from the 'Overall LLM Analysis Content'. Focus on strengths that support ${context.org_purpose}. Example: 'Clear and professional visual design that builds trust.'"
  ],
  "performance_summary": "Provide a 1-2 sentence overview of the website's technical performance, drawing from the 'Overall LLM Analysis Content' or the separate technical summary if applicable. If not detailed, state 'Technical performance data should be reviewed for detailed insights.'.",
  "detailed_markdown_content": ${"`/* Verbatim copy of the 'Overall LLM Analysis Content' provided above. This entire markdown block goes here as a single string. Ensure newlines are escaped (\\\\n). */`"}
}

IMPORTANT RULES FOR JSON OUTPUT:
- Adhere strictly to the JSON structure.
- "overall_score" MUST be a number between 1 and 10.
- "site_score_explanation" MUST be a concise 1-2 sentence string explaining the overall site score.
- "most_critical_issues", "top_recommendations", "key_strengths" MUST be arrays of strings, summarized from the detailed markdown.
- All content should be considered in the context of ${context.org_name} (${context.org_type}) and their purpose: ${context.org_purpose}.
- "detailed_markdown_content" MUST be a single string containing the complete raw markdown of the 'Overall LLM Analysis Content'. Ensure all newlines within this markdown are properly escaped as \\\\n for the JSON string.
- All other summary string fields should be concise and derived from the 'Overall LLM Analysis Content'.
- DO NOT use markdown (e.g., no \`\`\`, no \`*\`) within the summarized string fields like executive_summary, site_score_explanation, most_critical_issues items, etc.
- The final output MUST start with \`{\` and end with \`}\` and be parseable by JSON.parse().
`
  };
}

module.exports = { getFormattingPrompts };