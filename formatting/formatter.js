require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { getFormattingPrompts } = require('./prompts/formatting-prompts');
const { validateStructuredData } = require('./utils/validator');

class Formatter {
  constructor(options = {}) {
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
    this.concurrency = options.concurrency || 4;
    this.orgContext = options.orgContext || { // Added orgContext initialization
      org_name: 'the organization',
      org_type: 'organization',
      org_purpose: 'to achieve its business goals and serve its users effectively'
    };

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  extractSectionScores(analysisText) {
    const scores = {};
    if (!analysisText || typeof analysisText !== 'string') {
      return scores;
    }
    const sectionMappings = {
      'FIRST IMPRESSION & CLARITY': 'first_impression_clarity',
      'GOAL ALIGNMENT': 'goal_alignment',
      'VISUAL DESIGN': 'visual_design',
      'CONTENT QUALITY': 'content_quality',
      'USABILITY & ACCESSIBILITY': 'usability_accessibility',
      'CONVERSION OPTIMIZATION': 'conversion_optimization',
      'TECHNICAL EXECUTION': 'technical_execution'
    };
    const scoreRegex = /##\s*\d+\.\s*([^(]+)\(Score:\s*(\d+)\/10\)/gi;
    let match;
    while ((match = scoreRegex.exec(analysisText)) !== null) {
      const sectionNameFull = match[1].trim().toUpperCase();
      const score = parseInt(match[2], 10);
      for (const [key, value] of Object.entries(sectionMappings)) {
        if (sectionNameFull.includes(key)) {
          scores[value] = score;
          break;
        }
      }
    }
    return scores;
  }

  extractListFallback(text, keywords) {
    const items = [];
    if (!text || typeof text !== 'string') return items;
    const lines = text.split('\n');
    let inRelevantBlock = !keywords.length;
    const keywordRegex = new RegExp(`(?:${keywords.join('|')}):`, 'i');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (keywords.length && keywordRegex.test(trimmedLine)) {
            inRelevantBlock = true;
            continue;
        }
        if (inRelevantBlock) {
            if (trimmedLine.match(/^[-*•\d]\s/) || trimmedLine.match(/^\d+\.\s/)) {
                let itemText = trimmedLine.replace(/^[-*•\d\.]\s*/, '').trim();
                const fixMatch = itemText.match(/(.*?)\s*How to Fix:\s*(.*)/i);
                const benefitMatch = itemText.match(/(.*?)\s*Benefit:\s*(.*)/i);

                if (keywords.some(k => k.toLowerCase().includes('issue') || k.toLowerCase().includes('flaw')) && fixMatch) {
                    items.push({ issue: fixMatch[1].trim(), how_to_fix: fixMatch[2].trim() });
                } else if (keywords.some(k => k.toLowerCase().includes('recommendation')) && benefitMatch) {
                     items.push({ recommendation: benefitMatch[1].trim(), benefit: benefitMatch[2].trim() });
                } else {
                    if (keywords.some(k => k.toLowerCase().includes('issue') || k.toLowerCase().includes('flaw'))) {
                        items.push({ issue: itemText, how_to_fix: "Details not parsed." });
                    } else if (keywords.some(k => k.toLowerCase().includes('recommendation'))) {
                         items.push({ recommendation: itemText, benefit: "Details not parsed." });
                    } else {
                         items.push(itemText);
                    }
                }
            } else if (trimmedLine.match(/^(##|SUMMARY:|PAGE ROLE ANALYSIS:)/i) && keywords.length) {
                 inRelevantBlock = false;
            }
        }
    }
    return items.filter(item => (typeof item === 'string' && item.length > 5) || (typeof item === 'object' && item !== null));
  }

  extractScoreFallback(text) {
    if (!text || typeof text !== 'string') return null;
    const scoreMatch = text.match(/(?:overall_score|overall score|score is|score of)[:\s]*(\d+)(?:\/10)?/i);
    if (scoreMatch && scoreMatch[1]) return parseInt(scoreMatch[1], 10);
    const genericScoreMatch = text.match(/Score:\s*(\d+)\/10/i);
    if (genericScoreMatch && genericScoreMatch[1]) return parseInt(genericScoreMatch[1],10);
    return 3;
  }

  extractSummaryFallback(text, maxLength = 250) {
    if (!text || typeof text !== 'string') return "Summary not available.";
    const summaryMatch = text.match(/(?:SUMMARY|EXECUTIVE_SUMMARY|EXECUTIVE SUMMARY):?\s*([\s\S]*?)(?=\n\n##|\n\nPAGE ROLE ANALYSIS:|\n\nCRITICAL FLAWS:|\n\nACTIONABLE RECOMMENDATIONS:|$)/i);
    if (summaryMatch && summaryMatch[1] && summaryMatch[1].trim().length > 20) {
      return summaryMatch[1].replace(/Overall effectiveness score:\s*\d+\/10\s*-?/, '').replace(/Highest priority action:/, '').trim().substring(0, maxLength) + (summaryMatch[1].length > maxLength ? "..." : "");
    }
    const firstMeaningfulParagraph = text.split('\n\n').find(p => p.trim().length > 50 && !p.trim().startsWith("##"));
    return firstMeaningfulParagraph ? firstMeaningfulParagraph.trim().substring(0, maxLength) + (firstMeaningfulParagraph.length > maxLength ? "..." : "") : "Summary requires manual review.";
  }

  extractOverallExplanationFallback(text) {
      if (!text || typeof text !== 'string') return "Explanation not available.";
      const explanationMatch = text.match(/(?:overall_explanation|overall explanation)[:\s]*"([^"]*)"/i);
      if (explanationMatch && explanationMatch[1]) return explanationMatch[1];
      return "Overall score explanation requires manual review due to formatting issues.";
  }

  extractPageType(url) {
    if (!url || typeof url !== 'string') return 'Page';
    try {
      const saneUrl = !url.startsWith('http') ? `https://${url}` : url;
      const path = new URL(saneUrl).pathname.toLowerCase();
      if (path === '/' || path === '' || path.includes('index') || path.endsWith(new URL(saneUrl).hostname)) return 'Homepage';
      if (path.includes('contact')) return 'Contact Page';
      if (path.includes('about')) return 'About Page';
      if (path.includes('training')) return 'Training Page';
      if (path.includes('research')) return 'Research Page';
      if (path.includes('project')) return 'Projects Page';
      if (path.includes('cart')) return 'Cart Page';
      const parts = path.split('/').filter(Boolean);
      const lastPart = parts.pop() || 'generic';
      return lastPart.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) + ' Page';
    } catch (e) {
      const pathSegment = url.substring(url.lastIndexOf('/') + 1);
      const simpleName = pathSegment.split('.')[0];
      return simpleName.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Page';
    }
  }

  extractSectionTextFallback(text, sectionKey) {
    if (!text || typeof text !== 'string') return null;
    const regex = new RegExp(`"${sectionKey}"\\s*:\\s*"([^"]*)"`, 'i');
    const match = text.match(regex);
    if (match && match[1]) return match[1];
    const sectionRegex = new RegExp(`(?:${sectionKey.replace("_", " ")}|${sectionKey}):\\s*([\\s\\S]*?)(?=\\n\\n[A-Z\\s]+:|$)`, 'i');
    const sectionMatch = text.match(sectionRegex);
    return sectionMatch && sectionMatch[1] ? sectionMatch[1].trim().substring(0, 200) + "..." : null;
  }

  parseJSON(text, source) {
    let cleanedText = text.trim();

    try {
      const parsed = JSON.parse(cleanedText);
      console.log(`     ✅ Successfully parsed JSON for ${source}`);
      return parsed;
    } catch (e) { /* continue to next attempt */ }

    const codeBlockMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        console.log(`     ✅ Successfully parsed JSON from code block for ${source}`);
        return parsed;
      } catch (e) { /* continue to next attempt */ }
    }

    const firstBrace = cleanedText.indexOf('{');
    const lastBrace = cleanedText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const potentialJson = cleanedText.substring(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(potentialJson);
        console.log(`     ✅ Successfully extracted and parsed JSON object for ${source}`);
        return parsed;
      } catch (e) { /* continue to fallback */ }
    }

    console.warn(`     ⚠️  JSON parse failed for ${source}, using text extraction fallback.`);
    if (source === 'overall summary') {
      return this.extractOverallSummaryFromTextFallback(cleanedText);
    } else {
      return this.extractPageDataFromTextFallback(cleanedText, source);
    }
  }

  extractOverallSummaryFromTextFallback(text) {
    console.log('     📝 Using text extraction fallback for overall summary');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const nestedData = JSON.parse(jsonMatch[0]);
        console.log('     🔍 Found nested JSON in LLM response');
        return {
          executive_summary: nestedData.executive_summary || this.extractSummaryFallback(text, 500) || 'Website analysis summary requires review.',
          overall_score: nestedData.overall_score || this.extractScoreFallback(text) || 5,
          site_score_explanation: nestedData.site_score_explanation || "Overall site score explanation requires manual review.",
          total_pages_analyzed: nestedData.total_pages_analyzed || 0,
          most_critical_issues: Array.isArray(nestedData.most_critical_issues) ? nestedData.most_critical_issues.map(String) : this.extractListFallback(text, ['critical_issues', 'site-wide critical issue']).map(item => typeof item === 'object' ? item.issue : String(item)).slice(0, 5),
          top_recommendations: Array.isArray(nestedData.top_recommendations) ? nestedData.top_recommendations.map(String) : this.extractListFallback(text, ['top_recommendations', 'priority recommendation']).map(item => typeof item === 'object' ? item.recommendation : String(item)).slice(0, 5),
          key_strengths: Array.isArray(nestedData.key_strengths) ? nestedData.key_strengths.map(String) : this.extractListFallback(text, ['key_strengths', 'website does well']).map(item => String(item)).slice(0, 3),
          performance_summary: nestedData.performance_summary || this.extractSectionTextFallback(text, 'performance_summary') || 'Performance details require review.',
          detailed_markdown_content: nestedData.detailed_markdown_content || text // THIS IS THE KEY LINE FOR THE BUG
        };
      } catch (e) {
        console.warn('     ⚠️ Failed to parse nested JSON, using manual extraction for overall summary fallback');
      }
    }

    return {
      executive_summary: this.extractSummaryFallback(text, 500) || 'Website analysis summary requires review.',
      overall_score: this.extractScoreFallback(text) || 5,
      site_score_explanation: "Overall site score explanation requires manual review.",
      total_pages_analyzed: 0,
      most_critical_issues: this.extractListFallback(text, ['critical_issues', 'site-wide critical issue']).map(item => typeof item === 'object' ? item.issue : String(item)).slice(0, 5),
      top_recommendations: this.extractListFallback(text, ['top_recommendations', 'priority recommendation']).map(item => typeof item === 'object' ? item.recommendation : String(item)).slice(0, 5),
      key_strengths: this.extractListFallback(text, ['key_strengths', 'website does well']).map(item => String(item)).slice(0, 3),
      performance_summary: this.extractSectionTextFallback(text, 'performance_summary') || 'Performance details require review.',
      detailed_markdown_content: text
    };
  }

  extractPageDataFromTextFallback(analysisText, url) {
    const key_issue_objects = this.extractListFallback(analysisText, ['CRITICAL FLAWS', 'issues', 'problems', 'flaws']).slice(0, 8);
    const recommendation_objects = this.extractListFallback(analysisText, ['ACTIONABLE RECOMMENDATIONS', 'recommendations', 'suggestions', 'improvements']).slice(0, 8);
    return {
      page_type: this.extractPageType(url),
      title: this.extractPageType(url) || "Untitled Page (Fallback)",
      overall_score: this.extractScoreFallback(analysisText) || 3,
      overall_explanation: this.extractOverallExplanationFallback(analysisText) || "Detailed explanation requires manual review.",
      sections: [],
      section_scores: this.extractSectionScores(analysisText),
      key_issues: key_issue_objects.map(item =>
        typeof item === 'object' && item.issue ? item : { issue: String(item.issue || item), how_to_fix: String(item.how_to_fix || "Fix details not parsed.") }
      ),
      recommendations: recommendation_objects.map(item =>
        typeof item === 'object' && item.recommendation ? item : { recommendation: String(item.recommendation || item), benefit: String(item.benefit || "Benefit details not parsed.") }
      ),
      summary: this.extractSummaryFallback(analysisText, 150) || 'Page analysis summary requires manual review.'
    };
  }

  async format(rawAnalysisData) {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        return { status: 'error', error: 'ANTHROPIC_API_KEY environment variable is not set', data: rawAnalysisData };
      }
      console.log('🔄 Formatting analysis for individual pages + overall summary...');
      const pageAnalysesFormatted = await this.formatPageAnalysesConcurrently(rawAnalysisData);
      const overallSummaryFormatted = await this.createOverallSummary(rawAnalysisData, pageAnalysesFormatted);

      const structuredData = {
        timestamp: new Date().toISOString(),
        overall_summary: overallSummaryFormatted,
        page_analyses: pageAnalysesFormatted,
        metadata: {
          total_pages: pageAnalysesFormatted.length,
          analysis_provider: rawAnalysisData.provider,
          analysis_model: rawAnalysisData.model,
          generated_at: new Date().toISOString(),
          ...(rawAnalysisData.metadata || {})
        }
      };
      console.log('🔍 Validating structured data...');
      const validationResult = validateStructuredData(structuredData); // Ensure validator can handle this.orgContext

      if (validationResult.valid) {
        console.log('   ✅ Structured data validated successfully.');
        return { status: 'success', data: validationResult.data };
      } else {
        console.error('   ❌ Validation failed:', JSON.stringify(validationResult.errors, null, 2));
        return {
          status: 'error',
          error: 'Structured data validation failed: ' + validationResult.errors.join('; '),
          data: validationResult.data
        };
      }
    } catch (error) {
      console.error('Error during main formatting process:', error);
      return { status: 'error', error: error.message, data: rawAnalysisData };
    }
  }

  async formatPageAnalysesConcurrently(rawAnalysisData) {
    const pageAnalysesInput = rawAnalysisData.pageAnalyses || [];
    if (pageAnalysesInput.length === 0) {
      console.log('   ⚠️  No page analyses found in raw data.');
      return [];
    }
    console.log(`📄 Formatting ${pageAnalysesInput.length} individual page analyses...`);
    console.log(`   🔀 Processing up to ${this.concurrency} pages concurrently`);

    const allResults = [];
    for (let i = 0; i < pageAnalysesInput.length; i += this.concurrency) {
      const batch = pageAnalysesInput.slice(i, i + this.concurrency);
      const batchNum = Math.floor(i / this.concurrency) + 1;
      console.log(`   Batch ${batchNum}/${Math.ceil(pageAnalysesInput.length / this.concurrency)}: Formatting ${batch.length} pages...`);
      const batchStartTime = Date.now();
      const promises = batch.map((pageAnalysisItem, batchIndex) =>
        this.formatIndividualPage(pageAnalysisItem, i + batchIndex)
      );
      const batchSettledResults = await Promise.all(promises);
      allResults.push(...batchSettledResults);
      const batchDuration = (Date.now() - batchStartTime) / 1000;
      console.log(`   ⚡ Batch ${batchNum} completed in ${batchDuration.toFixed(2)}s`);
    }
    return allResults;
  }

  async formatIndividualPage(pageAnalysisItem, index) {
    if (!pageAnalysisItem || typeof pageAnalysisItem.analysis !== 'string' || pageAnalysisItem.analysis.trim() === "") {
      console.warn(`     ⚠️  Skipping formatting for item at index ${index} (URL: ${pageAnalysisItem.url || 'N/A'}) due to missing, empty, or invalid analysis text.`);
      return this.createFallbackPageAnalysis(pageAnalysisItem || {url: `Unknown URL ${index}`, analysis: ""}, index);
    }
    console.log(`     📄 [${index}] Formatting: ${pageAnalysisItem.url}`);
    const prompt = getFormattingPrompts(this.orgContext).individualPage(pageAnalysisItem); // Pass orgContext
    let parsed;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      });
      const formattedText = response.content[0].text.trim();
      parsed = this.parseJSON(formattedText, pageAnalysisItem.url);
    } catch (error) {
      console.error(`     ❌ LLM call or initial parsing failed for ${pageAnalysisItem.url}:`, error.message);
      parsed = this.extractPageDataFromTextFallback(pageAnalysisItem.analysis, pageAnalysisItem.url);
    }

    const sectionScores = this.extractSectionScores(pageAnalysisItem.analysis);

    const finalParsed = {
        page_type: parsed.page_type || this.extractPageType(pageAnalysisItem.url),
        title: parsed.title || this.extractPageType(pageAnalysisItem.url) || `Page ${index + 1}`,
        overall_score: typeof parsed.overall_score === 'number' ? parsed.overall_score : (this.extractScoreFallback(pageAnalysisItem.analysis) || 3),
        overall_explanation: parsed.overall_explanation || "Requires manual review.",
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
        key_issues: [],
        recommendations: [],
        summary: parsed.summary || this.extractSummaryFallback(pageAnalysisItem.analysis, 150) || "Summary requires manual review.",
        url: pageAnalysisItem.url,
        original_analysis: pageAnalysisItem.analysis,
        section_scores: sectionScores,
    };

    finalParsed.key_issues = (Array.isArray(parsed.key_issues) ? parsed.key_issues : []).map(issue_item => {
        if (typeof issue_item === 'string') return { issue: issue_item, how_to_fix: "Fix details require review." };
        if (typeof issue_item === 'object' && issue_item !== null) {
            return {
                issue: String(issue_item.issue || "Issue text missing from parsed object."),
                how_to_fix: String(issue_item.how_to_fix || "Fix details not provided in parsed object.")
            };
        }
        return { issue: "Invalid issue format in parsed data.", how_to_fix: "Review needed."};
    }).slice(0,8);

    finalParsed.recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map(rec_item => {
        if (typeof rec_item === 'string') return { recommendation: rec_item, benefit: "Benefit details require review." };
        if (typeof rec_item === 'object' && rec_item !== null) {
            return {
                recommendation: String(rec_item.recommendation || "Recommendation text missing from parsed object."),
                benefit: String(rec_item.benefit || "Benefit details not provided in parsed object.")
            };
        }
        return { recommendation: "Invalid recommendation format in parsed data.", benefit: "Review needed."};
    }).slice(0,8);

    return finalParsed;
  }

  async createOverallSummary(rawAnalysisData, formattedPageAnalyses) {
    console.log('📊 Creating overall summary for main page...');
    const overviewContent = (rawAnalysisData && typeof rawAnalysisData.overview === 'string') ? rawAnalysisData.overview : "Comprehensive overview not available.";
    const promptRawData = { ...rawAnalysisData, overview: overviewContent };

    const prompt = getFormattingPrompts(this.orgContext).overallSummary(promptRawData, formattedPageAnalyses); // Pass orgContext
    let parsedSummary;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      });
      const summaryText = response.content[0].text.trim();
      console.log(`     📝 LLM response length for overall summary: ${summaryText.length} characters`);
      parsedSummary = this.parseJSON(summaryText, 'overall summary');

      // --- UPDATED FIX APPLICATION ---
      // Ensure detailed_markdown_content is the raw overviewContent from the analysis stage.
      // The LLM's job for this prompt is to populate the *other* summary fields by reading overviewContent.
      parsedSummary.detailed_markdown_content = overviewContent;
      console.log("   ✅ Ensured 'overall_summary.detailed_markdown_content' is set to the direct raw markdown overview.");
      // --- END OF UPDATED FIX ---

      if (typeof parsedSummary.site_score_explanation !== 'string' || parsedSummary.site_score_explanation.trim() === "") {
        console.warn("   ⚠️  LLM did not provide site_score_explanation. Attempting to extract or using fallback.");
        const extractedExplanation = this.extractSiteScoreExplanationFromMarkdown(overviewContent);
        parsedSummary.site_score_explanation = extractedExplanation || "Overall site score evaluation highlights key strengths and areas needing improvement.";
      }

    } catch (error) {
      console.error('   ❌ Failed to create overall summary via LLM:', error.message);
      parsedSummary = this.createFallbackOverallSummary(promptRawData, formattedPageAnalyses);
      // Fallback already sets detailed_markdown_content to overviewContent
    }

    const fallbackSummary = this.createFallbackOverallSummary(promptRawData, formattedPageAnalyses);
    parsedSummary = {
        ...fallbackSummary,
        ...parsedSummary,
        total_pages_analyzed: formattedPageAnalyses.length,
        // Ensure detailed_markdown_content remains the raw overviewContent after merging
        detailed_markdown_content: overviewContent,
        // Ensure overall_score is valid
        overall_score: (typeof parsedSummary.overall_score === 'number' && parsedSummary.overall_score >=1 && parsedSummary.overall_score <=10)
                       ? parsedSummary.overall_score
                       : fallbackSummary.overall_score,
        site_score_explanation: parsedSummary.site_score_explanation || fallbackSummary.site_score_explanation,
    };

    parsedSummary.most_critical_issues = (Array.isArray(parsedSummary.most_critical_issues) ? parsedSummary.most_critical_issues.map(String) : fallbackSummary.most_critical_issues || []).slice(0,5);
    parsedSummary.top_recommendations = (Array.isArray(parsedSummary.top_recommendations) ? parsedSummary.top_recommendations.map(String) : fallbackSummary.top_recommendations || []).slice(0,5);
    parsedSummary.key_strengths = (Array.isArray(parsedSummary.key_strengths) ? parsedSummary.key_strengths.map(String) : fallbackSummary.key_strengths || []).slice(0,3);

    return parsedSummary;
  }


  extractSiteScoreExplanationFromMarkdown(markdownContent) {
    if (!markdownContent || typeof markdownContent !== 'string') return null;
    const scoreMatch = markdownContent.match(/Overall.*?Score:\s*\d+\/10\s*-\s*(.*)/i);
    if (scoreMatch && scoreMatch[1]) {
      return scoreMatch[1].split('.')[0] + '.';
    }
    const executiveSummaryMatch = markdownContent.match(/## Executive Summary\s*([\s\S]*?)(?=\n##|$)/i);
    if (executiveSummaryMatch && executiveSummaryMatch[1]) {
        const firstSentences = executiveSummaryMatch[1].trim().split('.').slice(0,2).join('.') + '.';
        if (firstSentences.length > 30) return firstSentences;
    }
    return null;
  }

  createFallbackOverallSummary(rawAnalysisData, pageAnalyses) {
    let avgScore = 3;
    const validScores = pageAnalyses.filter(p => p && typeof p.overall_score === 'number').map(p => p.overall_score);
    if (validScores.length > 0) {
      avgScore = Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length);
    }
    const overviewText = (rawAnalysisData && typeof rawAnalysisData.overview === 'string') ? rawAnalysisData.overview : "Comprehensive overview markdown not available.";
    const fallbackSiteScoreExplanation = this.extractSiteScoreExplanationFromMarkdown(overviewText) || "Overall site performance has areas of strength and opportunities for significant improvement.";

    return {
      executive_summary: (rawAnalysisData.overview && typeof rawAnalysisData.overview === 'string' ? this.extractSummaryFallback(rawAnalysisData.overview, 500) : 'Overall website analysis requires review.'),
      overall_score: avgScore,
      site_score_explanation: fallbackSiteScoreExplanation,
      total_pages_analyzed: pageAnalyses.length,
      most_critical_issues: ['Review "detailed_markdown_content" for critical issues.'],
      top_recommendations: ['Implement fixes based on manual review of "detailed_markdown_content".'],
      key_strengths: ['Review "detailed_markdown_content" for strengths.'],
      performance_summary: (rawAnalysisData.technicalSummary && typeof rawAnalysisData.technicalSummary === 'string' ? this.extractSummaryFallback(rawAnalysisData.technicalSummary, 200) : 'Technical performance summary requires manual review.'),
      detailed_markdown_content: overviewText // Correctly uses the raw overview
    };
  }

  createFallbackPageAnalysis(pageAnalysisItem, index) {
    return {
      page_type: this.extractPageType(pageAnalysisItem.url),
      title: `Fallback Page ${index + 1}`,
      overall_score: 3,
      overall_explanation: "Analysis could not be processed properly.",
      sections: [],
      section_scores: {},
      key_issues: [],
      recommendations: [],
      summary: "This page analysis could not be processed due to missing or invalid data.",
      url: pageAnalysisItem.url,
      original_analysis: pageAnalysisItem.analysis || "No analysis data available."
    };
  }
}

module.exports = { Formatter };