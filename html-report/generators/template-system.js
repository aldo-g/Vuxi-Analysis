const nunjucks = require('nunjucks');
const path = require('path');

class TemplateSystem {
  constructor() {
    // Configure nunjucks
    const templateDir = path.join(__dirname, '../templates');
    this.env = nunjucks.configure(templateDir, {
      autoescape: true,
      trimBlocks: true,
      lstripBlocks: true
    });
    
    // Add custom filters
    this.addCustomFilters();
  }
  
  addCustomFilters() {
    // Add tojson filter
    this.env.addFilter('tojson', function(obj) {
      return JSON.stringify(obj);
    });
    
    // Add safe filter alias if needed
    this.env.addFilter('safe', function(str) {
      return new nunjucks.runtime.SafeString(str);
    });
  }
  
  render(templateName, context) {
    return this.env.render(templateName, context);
  }
  
  getCommonStyles() {
    return `
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        margin: 0;
        padding: 20px;
        color: #333;
        background-color: #f5f5f5;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background-color: #fff;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      }
      
      h1, h2, h3, h4, h5, h6 {
        color: #2c3e50;
        margin-top: 1.5em;
        margin-bottom: 0.7em;
        font-weight: 600;
      }
      
      h1 { 
        font-size: 2.2em; 
        border-bottom: 2px solid #eee;
        padding-bottom: 10px;
        margin-top: 0;
      }
      
      h2 { 
        font-size: 1.8em; 
        color: #34495e;
      }
      
      h3 { 
        font-size: 1.5em; 
        color: #3f5976;
      }
      
      .section {
        margin-bottom: 30px;
        padding: 20px;
        background-color: #fafafa;
        border-radius: 6px;
        border: 1px solid #eee;
      }
      
      .score-item {
        display: flex;
        align-items: center;
        margin-bottom: 15px;
        padding: 10px;
        background-color: #f8f9fa;
        border-radius: 4px;
      }
      
      .score-label {
        flex: 1;
        font-weight: 500;
      }
      
      .score-bar {
        flex: 2;
        height: 20px;
        background-color: #e0e0e0;
        border-radius: 10px;
        overflow: hidden;
        margin: 0 15px;
      }
      
      .score-fill {
        height: 100%;
        border-radius: 10px;
        transition: width 0.5s ease;
      }
      
      .score-value {
        font-weight: bold;
        min-width: 40px;
        text-align: right;
      }
      
      .good { color: #27ae60; background-color: #27ae60; }
      .average { color: #f39c12; background-color: #f39c12; }
      .poor { color: #e74c3c; background-color: #e74c3c; }
      
      .critical-issue {
        background-color: #fff5f7;
        border-left: 4px solid #e53e3e;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 4px;
      }
      
      .recommendation {
        background-color: #f0fdf4;
        border-left: 4px solid #10b981;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 4px;
      }
      
      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
      }
      
      .info-card {
        background-color: #f8fafc;
        padding: 15px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }
      
      .info-label {
        font-size: 0.9em;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 5px;
      }
      
      .info-value {
        font-size: 1.1em;
        color: #334155;
        font-weight: 500;
      }
      
      .screenshot {
        max-width: 100%;
        border: 1px solid #ddd;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      
      .navigation {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #eee;
        display: flex;
        justify-content: space-between;
      }
      
      .navigation a {
        color: #3b82f6;
        text-decoration: none;
        font-weight: 500;
      }
      
      .navigation a:hover {
        text-decoration: underline;
      }
      
      .list-item {
        margin-bottom: 10px;
        padding-left: 20px;
        position: relative;
      }
      
      .list-item::before {
        content: "•";
        color: #3b82f6;
        font-weight: bold;
        position: absolute;
        left: 0;
      }
      
      pre {
        background-color: #f5f5f5;
        padding: 15px;
        border-radius: 4px;
        overflow-x: auto;
        border: 1px solid #e0e0e0;
      }
      
      code {
        font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
        font-size: 0.9em;
      }
      
      @media (max-width: 768px) {
        body {
          padding: 10px;
        }
        
        .container {
          padding: 15px;
        }
        
        .info-grid {
          grid-template-columns: 1fr;
        }
        
        .navigation {
          flex-direction: column;
          gap: 10px;
        }
      }
    `;
  }
}

module.exports = { TemplateSystem };