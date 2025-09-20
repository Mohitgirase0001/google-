const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const ical = require('ical-generator');
const moment = require('moment');
const cors = require('cors');
const PDFDocument = require('pdfkit');



const app = express();
const port = process.env.PORT || 3000;

// Initialize Google Gemini AI (using a mock if no API key)
let genAI;
try {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'mock-api-key-for-development');
} catch (error) {
  console.log('Gemini AI not configured, using mock responses');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
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
    // Check file extension
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

// GST knowledge base
const gstKnowledgeBase = {
  deadlines: [
    { id: 1, form: 'GSTR-1', dueDate: '10th of every month', description: 'Details of outward supplies' },
    { id: 2, form: 'GSTR-3B', dueDate: '20th of every month', description: 'Monthly summary return' },
    { id: 3, form: 'GSTR-9', dueDate: '31st December', description: 'Annual return' }
  ],
  taxSlabs: [
    { id: 1, rate: 0, description: 'Exempted goods', hsnCodes: [] },
    { id: 2, rate: 5, description: 'Commonly used goods', hsnCodes: [] },
    { id: 3, rate: 12, description: 'Standard goods', hsnCodes: [] },
    { id: 4, rate: 18, description: 'Standard goods and services', hsnCodes: [] },
    { id: 5, rate: 28, description: 'Luxury goods', hsnCodes: [] }
  ],
  stateCodes: {
    '01': 'Jammu and Kashmir',
    '02': 'Himachal Pradesh',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh',
    '36': 'Telangana'
  }
};

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

// Helper function to calculate GST
function calculateGST(salesData) {
  let totalSales = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const salesByState = {};
  const salesByTaxSlab = {};

  salesData.forEach(sale => {
    const amount = parseFloat(sale.amount) || 0;
    const taxRate = parseFloat(sale.taxRate) || 18; // Default to 18% if not specified
    const state = sale.state || 'Unknown';
    
    totalSales += amount;
    
    // Categorize by state
    if (!salesByState[state]) {
      salesByState[state] = 0;
    }
    salesByState[state] += amount;
    
    // Categorize by tax slab
    if (!salesByTaxSlab[taxRate]) {
      salesByTaxSlab[taxRate] = 0;
    }
    salesByTaxSlab[taxRate] += amount;
    
    // Calculate tax (simplified logic)
    if (state === 'Home State') {
      // Intra-state sale: CGST + SGST
      const taxAmount = amount * (taxRate / 100);
      cgst += taxAmount / 2;
      sgst += taxAmount / 2;
    } else {
      // Inter-state sale: IGST
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

// AI Assistant function using Gemini or mock
async function askGemini(question, context = '') {
  try {
    // If Gemini is not configured, use mock responses
    if (!genAI) {
      const mockResponses = [
        "Based on your recent filing, you should focus on claiming all eligible Input Tax Credit to reduce your liability.",
        "For GST filing, ensure you maintain proper documentation of all invoices and keep track of your HSN codes.",
        "I recommend filing your returns at least 2 days before the deadline to avoid last-minute technical issues.",
        "Your tax liability seems reasonable for your business size. Consider consulting with a tax professional for optimized planning.",
        "Based on your sales pattern, you might benefit from the composition scheme if eligible. Would you like me to explain it?"
      ];
      return mockResponses[Math.floor(Math.random() * mockResponses.length)];
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `You are Vyapar Sahayak, an AI assistant specializing in Indian GST compliance for small businesses.
    ${context ? `Context: ${context}` : ''}
    Question: ${question}
    
    Please provide a helpful, accurate response based on Indian GST laws and regulations. 
    If you're unsure about something, acknowledge the limitation and suggest consulting a tax professional.
    Keep your response concise and practical.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return "I'm sorry, I'm having trouble connecting to my knowledge base. Please try again later or consult a tax professional for accurate information.";
  }
}
// Generate PDF report endpoint
// Generate PDF report endpoint
app.get('/api/report/:filingId', (req, res) => {
  try {
    console.log('Report generation requested for filing ID:', req.params.filingId);
    console.log('Available filings:', userData.filings.map(f => f.id));
    
    const filingId = parseInt(req.params.filingId);
    const filing = userData.filings.find(f => f.id === filingId);
   
    if (!filing) {
      console.log('Filing not found:', filingId);
      return res.status(404).json({ error: 'Filing not found' });
    }
    
    // Create a PDF document
    const doc = new PDFDocument();
    const filename = `GST-Report-${filingId}.pdf`;
    // Set response headers
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    // Pipe PDF to response
    doc.pipe(res);
    
    // Add content to PDF
    doc.fontSize(20).text('Vyapar Sahayak - GST Compliance Report', 100, 100);
    doc.fontSize(12).text(`Report generated on: ${new Date().toLocaleDateString()}`, 100, 130);
    
    // Add filing details
    doc.fontSize(16).text('Filing Summary', 100, 170);
    doc.fontSize(12)
    .text(`Filing ID: ${filing.id}`, 100, 200)
      .text(`Date: ${new Date(filing.timestamp).toLocaleDateString()}`, 100, 220)
      .text(`File: ${filing.fileName}`, 100, 240);
    
    // Add calculation details
    doc.fontSize(16).text('Tax Calculation', 100, 280);
    const calculation = filing.calculation;
    doc.fontSize(12)
      .text(`Total Sales: ₹${calculation.totalSales.toLocaleString()}`, 100, 310)
      .text(`CGST Liability: ₹${calculation.cgst.toFixed(2)}`, 100, 330)
      .text(`SGST Liability: ₹${calculation.sgst.toFixed(2)}`, 100, 350)
      .text(`IGST Liability: ₹${calculation.igst.toFixed(2)}`, 100, 370)
      .text(`Total Tax Liability: ₹${calculation.totalTax.toFixed(2)}`, 100, 390);
    
    // Add recommendations section
    doc.addPage();
    doc.fontSize(16).text('Recommendations & Next Steps', 100, 100);
    doc.fontSize(12)
      .text('1. File GSTR-1 by the 10th of next month', 100, 130)
      .text('2. File GSTR-3B by the 20th of next month', 100, 150)
      .text('3. Maintain proper documentation of all invoices', 100, 170)
      .text('4. Reconcile your books with GST returns regularly', 100, 190)
      .text('5. Claim eligible Input Tax Credit on time', 100, 210);
    
    // Add disclaimer
    doc.fontSize(10)
      .text('Disclaimer: This report is generated for informational purposes only. Please consult with a tax professional for official filing and compliance matters.', 100, 500);
    
    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// API Routes

// Upload sales data endpoint
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

    // Process the sales data and calculate GST
    const calculation = calculateGST(salesData);
    
    // Create a filing record
    const filing = {
      id: Date.now(),
      timestamp: new Date(),
      fileName: req.file.originalname,
      salesData: salesData,
      calculation: calculation
    };
    
    // Save to user data (in memory)
    userData.filings.push(filing);
    
    // Generate AI summary
    const context = `User just uploaded sales data with total sales of ₹${calculation.totalSales.toLocaleString()}. 
    Tax liability: CGST: ₹${calculation.cgst.toFixed(2)}, SGST: ₹${calculation.sgst.toFixed(2)}, IGST: ₹${calculation.igst.toFixed(2)}.`;
    
    const summary = await askGemini("Provide a brief summary of this GST filing and any recommendations.", context);
    
    res.json({
      success: true,
      message: 'File processed successfully',
      filing: filing,
      summary: summary
    });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Get deadlines endpoint
app.get('/api/deadlines', (req, res) => {
  try {
    // Get current month and year
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Format deadlines with actual dates
    const formattedDeadlines = gstKnowledgeBase.deadlines.map(deadline => {
      let dueDate;
      
      if (deadline.form === 'GSTR-1') {
        dueDate = new Date(currentYear, currentMonth, 10); // 10th of current month
      } else if (deadline.form === 'GSTR-3B') {
        dueDate = new Date(currentYear, currentMonth, 20); // 20th of current month
      } else if (deadline.form === 'GSTR-9') {
        dueDate = new Date(currentYear, 11, 31); // 31st December
      }
      
      return {
        ...deadline,
        dueDate: dueDate.toISOString().split('T')[0],
        daysRemaining: Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))
      };
    });
    
    res.json({
      success: true,
      deadlines: formattedDeadlines
    });
  } catch (error) {
    console.error('Error fetching deadlines:', error);
    res.status(500).json({ error: 'Failed to fetch deadlines' });
  }
});
// AI Assistant endpoint - improved with better mock responses
app.post('/api/assistant', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    // Get context from user's recent filings
    let context = '';
    if (userData.filings.length > 0) {
      const latestFiling = userData.filings[userData.filings.length - 1];
      context = `User's latest filing shows total sales of ₹${latestFiling.calculation.totalSales.toLocaleString()} 
      with tax liability of ₹${latestFiling.calculation.totalTax.toFixed(2)}.`;
    }
    
    // Use mock responses if Gemini is not configured
    let answer = "I'm here to help with GST compliance! For accurate filing advice, please consult a tax professional.";
    
    // Provide contextual responses based on keywords in the question
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('gstr-1') || lowerQuestion.includes('gstr1')) {
      answer = "GSTR-1 is a return that contains details of all outward supplies (sales). It must be filed by the 10th of the following month. You need to include invoice-wise details of all sales.";
    } else if (lowerQuestion.includes('gstr-3b') || lowerQuestion.includes('gstr3b')) {
      answer = "GSTR-3B is a monthly summary return that must be filed by the 20th of the following month. It includes summary of outward supplies, input tax credit claimed, and tax payment details.";
    } else if (lowerQuestion.includes('deadline') || lowerQuestion.includes('due date')) {
      answer = "GST filing deadlines are: GSTR-1 by the 10th, GSTR-3B by the 20th of the following month. I can help you add these to your calendar.";
    } else if (lowerQuestion.includes('itc') || lowerQuestion.includes('input tax')) {
      answer = "Input Tax Credit (ITC) allows you to reduce your tax liability by claiming credit for taxes paid on your purchases. You need valid tax invoices from registered suppliers to claim ITC.";
    } else if (lowerQuestion.includes('rate') || lowerQuestion.includes('tax slab')) {
      answer = "Common GST rates are: 0% (essential goods), 5% (common items), 12% and 18% (standard rates), and 28% (luxury items). The rate depends on the HSN code of your products.";
    } else if (lowerQuestion.includes('penalty') || lowerQuestion.includes('late')) {
      answer = "Late filing of GST returns attracts a penalty of ₹50 per day (₹20 for nil returns) and interest at 18% per annum on the tax amount due.";
    } else if (lowerQuestion.includes('hsn') || lowerQuestion.includes('sac')) {
      answer = "HSN (Harmonized System of Nomenclature) codes are used to classify goods. SAC (Services Accounting Code) is used for services. You need to include the appropriate code on your invoices based on your products/services.";
    }
    
    // Save question to history
    userData.questions.push({
      question,
      answer,
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      answer: answer
    });
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: 'Failed to process question' });
  }
});
    

// Add to calendar endpoint
app.post('/api/calendar', (req, res) => {
  try {
    const { deadlineId, reminderDate } = req.body;
    
    if (!deadlineId) {
      return res.status(400).json({ error: 'Deadline ID is required' });
    }
    
    // Find the deadline
    const deadline = gstKnowledgeBase.deadlines.find(d => d.id === parseInt(deadlineId));
    
    if (!deadline) {
      return res.status(404).json({ error: 'Deadline not found' });
    }
    
    // Create calendar event
    const cal = ical({
      name: 'Vyapar Sahayak GST Reminder'
    });
    
    const eventDate = reminderDate ? new Date(reminderDate) : new Date();
    
    cal.createEvent({
      start: eventDate,
      end: new Date(eventDate.getTime() + (60 * 60 * 1000)), // 1 hour event
      summary: `GST Filing Reminder: ${deadline.form}`,
      description: `Reminder to file ${deadline.form}: ${deadline.description}. Due date: ${deadline.dueDate}`,
      location: 'Online GST Portal'
    });
    
    // Save to user data
    userData.deadlines.push({
      deadlineId: parseInt(deadlineId),
      reminderDate: eventDate,
      added: new Date()
    });
    
    res.json({
      success: true,
      message: 'Deadline added to calendar',
      calendar: cal.toString()
    });
  } catch (error) {
    console.error('Error adding to calendar:', error);
    res.status(500).json({ error: 'Failed to add to calendar' });
  }
});

// Get filing history endpoint
app.get('/api/filings', (req, res) => {
  try {
    res.json({
      success: true,
      filings: userData.filings
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
  console.log(`Vyapar Sahayak server running at http://localhost:${port}`);
});