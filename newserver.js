const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ical = require('ical-generator');
const moment = require('moment');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const natural = require('natural');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Google Gemini AI
let genAI;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== 'mock-api-key-for-development') {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log('Gemini AI initialized successfully');
  } else {
    console.log('Gemini API key not configured, using intelligent responses');
  }
} catch (error) {
  console.log('Gemini AI initialization failed:', error.message);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create directories if they don't exist
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}
if (!fs.existsSync('knowledge-base')) {
  fs.mkdirSync('knowledge-base', { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /csv|xlsx|xls/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

// Initialize NLP tools for RAG
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();

// GST Knowledge Base with latest policies (2024)
const gstKnowledgeDocuments = [
  {
    id: 'gst_basics_2024',
    content: `GST (Goods and Services Tax) is a comprehensive indirect tax on the supply of goods and services in India. 
    As of 2024, GST has four primary tax slabs: 0% (essential goods), 5% (common items), 12% and 18% (standard rates), 
    and 28% (luxury items). The composition scheme limit has been increased to ₹1.5 crore.`,
    tags: ['basics', '2024', 'rates']
  },
  {
    id: 'gstr1_deadline_2024',
    content: `GSTR-1 must be filed by the 10th of the following month. It contains details of all outward supplies (sales) 
    made during the tax period. Late filing attracts a penalty of ₹50 per day (₹20 for nil returns).`,
    tags: ['gstr1', 'deadline', '2024', 'penalty']
  },
  {
    id: 'gstr3b_deadline_2024', 
    content: `GSTR-3B must be filed by the 20th of the following month. It is a monthly summary return that includes 
    summary of outward supplies, input tax credit claimed, and tax payment details. Interest at 18% per annum on late payment.`,
    tags: ['gstr3b', 'deadline', '2024', 'interest']
  },
  {
    id: 'itc_rules_2024',
    content: `Input Tax Credit (ITC) can be claimed only if: 1) You possess a valid tax invoice 2) Goods/services have been received 
    3) Supplier has filed their returns 4) Tax has been paid to government. New 2024 rule: ITC claim period extended to 30 days 
    from date of invoice.`,
    tags: ['itc', 'input tax credit', '2024', 'rules']
  },
  {
    id: 'new_tax_policies_2024',
    content: `2024 GST Updates: 1) Composition scheme limit increased to ₹1.5 crore 2) Online gaming taxed at 28% 3) 
    Penalty relief for small taxpayers 4) Enhanced invoice matching system 5) E-invoicing mandatory for ₹5 crore+ turnover`,
    tags: ['2024', 'updates', 'policy', 'changes']
  },
  {
    id: 'gst_rates_2024',
    content: `GST Rate Structure 2024:
    - 0%: Essential goods, fresh food items, agricultural products
    - 5%: Common use items, apparel below ₹1000, packaged foods
    - 12%: Processed foods, computers, mobile phones
    - 18%: Most goods and services, AC restaurants, financial services
    - 28%: Luxury goods, sin goods, premium cars, online gaming`,
    tags: ['rates', '2024', 'tax_slabs']
  }
];

// Initialize knowledge base
function initializeKnowledgeBase() {
  gstKnowledgeDocuments.forEach(doc => {
    tfidf.addDocument(doc.content, doc.id);
  });
  
  // Load additional knowledge from files
  const knowledgePath = path.join(__dirname, 'knowledge-base');
  if (fs.existsSync(knowledgePath)) {
    const files = fs.readdirSync(knowledgePath);
    files.forEach(file => {
      if (file.endsWith('.txt')) {
        const content = fs.readFileSync(path.join(knowledgePath, file), 'utf8');
        tfidf.addDocument(content, file);
        gstKnowledgeDocuments.push({ id: file, content, tags: ['file'] });
      }
    });
  }
  
  console.log('RAG System: Knowledge base initialized with', gstKnowledgeDocuments.length, 'documents');
}

// AGENTIC AI: Autonomous Compliance Agent
class TaxComplianceAgent {
  constructor() {
    this.actions = [];
    this.businessProfile = null;
    this.compliancePlan = null;
  }
  
  async processBusinessData(salesData) {
    console.log('Agent: Processing business data...');
    
    // Step 1: Calculate taxes
    const taxCalculation = this.calculateTaxes(salesData);
    
    // Step 2: Analyze business patterns
    const businessAnalysis = this.analyzeBusinessPatterns(salesData, taxCalculation);
    
    // Step 3: Check compliance requirements
    const complianceCheck = await this.checkCompliance(businessAnalysis);
    
    // Step 4: Generate compliance plan
    this.compliancePlan = await this.generateCompliancePlan(businessAnalysis, complianceCheck);
    
    // Step 5: Prepare documents and reminders
    const documents = await this.prepareComplianceDocuments(taxCalculation, complianceCheck);
    
    return {
      taxCalculation,
      businessAnalysis,
      complianceCheck,
      compliancePlan: this.compliancePlan,
      documents
    };
  }
  
  calculateTaxes(salesData) {
    let totalSales = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const salesByState = {};
    const salesByTaxSlab = {};

    salesData.forEach(sale => {
      const amount = parseFloat(sale.amount) || 0;
      const taxRate = parseFloat(sale.taxRate) || this.determineTaxRate(sale);
      const state = sale.state || 'Unknown';
      
      totalSales += amount;
      
      if (!salesByState[state]) salesByState[state] = 0;
      salesByState[state] += amount;
      
      if (!salesByTaxSlab[taxRate]) salesByTaxSlab[taxRate] = 0;
      salesByTaxSlab[taxRate] += amount;
      
      if (state === 'Home State') {
        const taxAmount = amount * (taxRate / 100);
        cgst += taxAmount / 2;
        sgst += taxAmount / 2;
      } else {
        igst += amount * (taxRate / 100);
      }
    });

    return { 
      totalSales, 
      cgst, 
      sgst, 
      igst, 
      totalTax: cgst + sgst + igst, 
      salesByState, 
      salesByTaxSlab 
    };
  }
  
  determineTaxRate(sale) {
    // Simple tax rate determination logic
    const product = (sale.product || '').toLowerCase();
    if (product.includes('essential') || product.includes('food')) return 0;
    if (product.includes('common') || product.includes('basic')) return 5;
    if (product.includes('standard') || product.includes('processed')) return 12;
    if (product.includes('luxury') || product.includes('premium')) return 28;
    return 18; // Default rate
  }
  
  analyzeBusinessPatterns(salesData, taxCalculation) {
    const primaryTaxSlab = Object.keys(taxCalculation.salesByTaxSlab).reduce((a, b) => 
      taxCalculation.salesByTaxSlab[a] > taxCalculation.salesByTaxSlab[b] ? a : b
    );
    
    const primaryState = Object.keys(taxCalculation.salesByState).reduce((a, b) => 
      taxCalculation.salesByState[a] > taxCalculation.salesByState[b] ? a : b
    );
    
    return {
      primaryTaxSlab,
      primaryState,
      averageTransaction: taxCalculation.totalSales / salesData.length,
      businessSize: this.classifyBusinessSize(taxCalculation.totalSales),
      complianceRisk: this.assessComplianceRisk(salesData, taxCalculation)
    };
  }
  
  classifyBusinessSize(totalSales) {
    const monthlySales = totalSales; // Assuming data is for one month
    if (monthlySales < 100000) return 'Micro';
    if (monthlySales < 1000000) return 'Small';
    if (monthlySales < 5000000) return 'Medium';
    return 'Large';
  }
  
  assessComplianceRisk(salesData, taxCalculation) {
    // Simple risk assessment
    let riskScore = 0;
    if (taxCalculation.igst > 0) riskScore += 1; // Interstate sales
    if (Object.keys(taxCalculation.salesByTaxSlab).length > 3) riskScore += 1; // Multiple tax rates
    if (taxCalculation.totalTax / taxCalculation.totalSales > 0.15) riskScore += 1; // High tax burden
    
    return riskScore < 2 ? 'Low' : riskScore < 4 ? 'Medium' : 'High';
  }
  
  async checkCompliance(businessAnalysis) {
    const relevantLaws = retrieveRelevantKnowledge(`GST compliance requirements for ${businessAnalysis.businessSize} business in ${businessAnalysis.primaryState}`);
    
    return {
      applicableReturns: ['GSTR-1', 'GSTR-3B'],
      deadlines: this.calculateDeadlines(),
      itcEligibility: businessAnalysis.complianceRisk === 'Low',
      specialSchemes: businessAnalysis.businessSize === 'Micro' ? ['Composition Scheme'] : [],
      riskAreas: businessAnalysis.complianceRisk !== 'Low' ? ['Interstate Sales', 'Multiple Tax Rates'] : []
    };
  }
  
  calculateDeadlines() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    
    return {
      gstr1: new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 10),
      gstr3b: new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 20),
      payment: new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 20)
    };
  }
  
  async generateCompliancePlan(businessAnalysis, complianceCheck) {
    const prompt = `Create a comprehensive 3-month GST compliance plan for a ${businessAnalysis.businessSize} business 
    with ${businessAnalysis.complianceRisk} compliance risk. Focus on: ${complianceCheck.riskAreas.join(', ')}. 
    Include monthly actions, deadlines, and risk mitigation strategies.`;
    
    try {
      if (genAI) {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
      }
    } catch (error) {
      console.error('AI plan generation failed:', error);
    }
    
    // Fallback plan
    return `COMPLIANCE PLAN FOR ${businessAnalysis.businessSize} BUSINESS:
    
    Month 1:
    - File GSTR-1 by ${complianceCheck.deadlines.gstr1.toDateString()}
    - File GSTR-3B by ${complianceCheck.deadlines.gstr3b.toDateString()}
    - Pay taxes by ${complianceCheck.deadlines.payment.toDateString()}
    - Reconcile input tax credit claims
    
    Month 2:
    - Review compliance with new 2024 regulations
    - Optimize tax strategy based on sales patterns
    - Prepare for upcoming deadlines
    
    Month 3:
    - Conduct compliance health check
    - Plan for next quarter based on business trends
    - Consider ${complianceCheck.specialSchemes.join(', ')} if applicable`;
  }
  
  async prepareComplianceDocuments(taxCalculation, complianceCheck) {
    const docs = [];
    
    // Generate tax summary
    docs.push(this.generateTaxSummary(taxCalculation));
    
    // Generate compliance checklist
    docs.push(this.generateComplianceChecklist(complianceCheck));
    
    // Generate payment instructions
    docs.push(await this.generatePaymentInstructions(taxCalculation.totalTax));
    
    return docs;
  }
  
  generateTaxSummary(taxCalculation) {
    return {
      type: 'Tax Summary',
      content: `TAX CALCULATION SUMMARY:
      Total Sales: ₹${taxCalculation.totalSales.toLocaleString()}
      CGST Liability: ₹${taxCalculation.cgst.toFixed(2)}
      SGST Liability: ₹${taxCalculation.sgst.toFixed(2)}
      IGST Liability: ₹${taxCalculation.igst.toFixed(2)}
      Total Tax Payable: ₹${taxCalculation.totalTax.toFixed(2)}
      
      RECOMMENDATIONS:
      - File returns before deadlines to avoid penalties
      - Claim eligible input tax credit
      - Maintain proper documentation`
    };
  }
  
  generateComplianceChecklist(complianceCheck) {
    return {
      type: 'Compliance Checklist',
      content: `COMPLIANCE CHECKLIST:
      [ ] File GSTR-1 by ${complianceCheck.deadlines.gstr1.toDateString()}
      [ ] File GSTR-3B by ${complianceCheck.deadlines.gstr3b.toDateString()}
      [ ] Pay taxes by ${complianceCheck.deadlines.payment.toDateString()}
      [ ] Reconcile input tax credit
      [ ] Maintain invoice records
      [ ] Review compliance with new 2024 rules`
    };
  }
  
  async generatePaymentInstructions(taxAmount) {
    const prompt = `Generate step-by-step payment instructions for paying GST of ₹${taxAmount} 
    including online payment methods, bank options, and documentation required.`;
    
    try {
      if (genAI) {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return {
          type: 'Payment Instructions',
          content: response.text()
        };
      }
    } catch (error) {
      console.error('AI payment instructions failed:', error);
    }
    
    // Fallback instructions
    return {
      type: 'Payment Instructions',
      content: `HOW TO PAY GST OF ₹${taxAmount}:
      
      1. Login to GST portal (gst.gov.in)
      2. Go to Services > Payments > Create Challan
      3. Enter tax amount: ₹${taxAmount}
      4. Select payment method: Net Banking/Credit Card/UPI
      5. Complete payment process
      6. Save payment receipt (Challan)
      7. Use Challan number when filing returns`
    };
  }
}

// Initialize Agentic AI System
const taxAgent = new TaxComplianceAgent();
initializeKnowledgeBase();

// Retrieve relevant knowledge for RAG
function retrieveRelevantKnowledge(query, maxResults = 3) {
  const results = [];
  
  tfidf.tfidfs(query, (i, measure) => {
    if (measure > 0) {
      const doc = gstKnowledgeDocuments[i];
      results.push({
        document: doc,
        relevance: measure,
        id: doc.id
      });
    }
  });
  
  return results.sort((a, b) => b.relevance - a.relevance).slice(0, maxResults);
}

// In-memory storage for user data
let userData = {
  filings: [],
  deadlines: [],
  questions: []
};

// Helper function to parse CSV files
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => reject(error));
  });
}

// API Routes

// Main upload endpoint - Fully agentic processing
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let salesData;
    if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      salesData = await parseCSV(req.file.path);
    } else {
      return res.status(400).json({ error: 'Excel support coming soon. Please upload a CSV file.' });
    }

    // Agentic AI processes everything automatically
    const processingResult = await taxAgent.processBusinessData(salesData);
    
    // Create filing record
    const filing = {
      id: Date.now(),
      timestamp: new Date(),
      fileName: req.file.originalname,
      salesData: salesData,
      processingResult: processingResult
    };
    
    // Save to user data
    userData.filings.push(filing);
    
    res.json({
      success: true,
      message: 'File processed successfully by Agentic AI system',
      filing: {
        id: filing.id,
        timestamp: filing.timestamp,
        fileName: filing.fileName,
        summary: processingResult.taxCalculation,
        compliancePlan: processingResult.compliancePlan,
        documents: processingResult.documents
      }
    });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Get filing details
app.get('/api/filing/:filingId', (req, res) => {
  try {
    const filingId = parseInt(req.params.filingId);
    const filing = userData.filings.find(f => f.id === filingId);
    
    if (!filing) {
      return res.status(404).json({ error: 'Filing not found' });
    }
    
    res.json({
      success: true,
      filing: filing
    });
  } catch (error) {
    console.error('Error fetching filing:', error);
    res.status(500).json({ error: 'Failed to fetch filing' });
  }
});

// Generate PDF report
app.get('/api/report/:filingId', (req, res) => {
  try {
    const filingId = parseInt(req.params.filingId);
    const filing = userData.filings.find(f => f.id === filingId);
   
    if (!filing) {
      return res.status(404).json({ error: 'Filing not found' });
    }
    
    const doc = new PDFDocument();
    const filename = `GST-Comprehensive-Report-${filingId}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    doc.pipe(res);
    
    // Add content to PDF
    doc.fontSize(20).text('Vyapar Sahayak - Comprehensive GST Report', 100, 100);
    doc.fontSize(12).text(`Report generated on: ${new Date().toLocaleDateString()}`, 100, 130);
    
    // Add tax calculation
    doc.fontSize(16).text('Tax Calculation Summary', 100, 170);
    const calc = filing.processingResult.taxCalculation;
    doc.fontSize(12)
      .text(`Total Sales: ₹${calc.totalSales.toLocaleString()}`, 100, 200)
      .text(`CGST Liability: ₹${calc.cgst.toFixed(2)}`, 100, 220)
      .text(`SGST Liability: ₹${calc.sgst.toFixed(2)}`, 100, 240)
      .text(`IGST Liability: ₹${calc.igst.toFixed(2)}`, 100, 260)
      .text(`Total Tax Payable: ₹${calc.totalTax.toFixed(2)}`, 100, 280);
    
    // Add compliance plan
    doc.addPage();
    doc.fontSize(16).text('Compliance Plan', 100, 100);
    doc.fontSize(12).text(filing.processingResult.compliancePlan, 100, 130, { width: 400 });
    
    doc.end();
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Get all filings
app.get('/api/filings', (req, res) => {
  try {
    res.json({
      success: true,
      filings: userData.filings.map(f => ({
        id: f.id,
        timestamp: f.timestamp,
        fileName: f.fileName,
        summary: f.processingResult.taxCalculation
      }))
    });
  } catch (error) {
    console.error('Error fetching filings:', error);
    res.status(500).json({ error: 'Failed to fetch filings' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`=================================================`);
  console.log(`Vyapar Sahayak Agentic AI Tax System Running`);
  console.log(`=================================================`);
  console.log(`Server URL: http://localhost:${port}`);
  console.log(`Agentic AI Systems: ✅ ACTIVE`);
  console.log(`- Tax Compliance Agent: ✅ READY`);
  console.log(`- RAG Knowledge Base: ✅ ${gstKnowledgeDocuments.length} documents`);
  console.log(`- Automated Processing: ✅ ENABLED`);
  console.log(`=================================================`);
  console.log('Agentic AI Features:');
  console.log('✅ Automatic tax calculation');
  console.log('✅ Compliance checking');
  console.log('✅ Business pattern analysis');
  console.log('✅ Personalized compliance plans');
  console.log('✅ Payment instructions');
  console.log('✅ Document generation');
  console.log(`=================================================`);
});