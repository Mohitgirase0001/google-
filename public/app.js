// Base URL for API calls
const API_BASE_URL = window.location.origin;

// Function to upload file
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
 
  try {
    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData
    });
   
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
   
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}
 
// Function to ask AI assistant
async function askAssistant(question) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question })
    });
   
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
   
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error asking assistant:', error);
    throw error;
  }
}

// Function to generate report - FIXED
async function generateReport(filingId) {
  try {
    showNotification('Generating report...', 'info');
    
    // Open report in new tab - CORRECTED URL
    window.open(`${API_BASE_URL}/api/report/${filingId}`, '_blank');
    
    showNotification('Report generated successfully!', 'success');
  } catch (error) {
    showNotification('Error generating report: ' + error.message, 'error');
    console.error('Report generation error:', error);
  }
}

// Function to get all filings
async function getFilings() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/filings`);
   
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
   
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching filings:', error);
    throw error;
  }
}
 
// Update your frontend event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Upload area interaction
  const uploadArea = document.querySelector('.upload-area');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,.xlsx,.xls';
  fileInput.style.display = 'none';
 
  uploadArea.appendChild(fileInput);
 
  uploadArea.addEventListener('click', function() {
    fileInput.click();
  });
 
  fileInput.addEventListener('change', async function() {
    if (fileInput.files.length > 0) {
      try {
        showNotification('Uploading and processing file...', 'info');
        const result = await uploadFile(fileInput.files[0]);
        console.log('Upload successful:', result);
       
        // Update UI with the result
        showNotification('File uploaded and processed successfully!', 'success');
       
        // Update the tax summary with result.filing.calculation
        if (result.filing && result.filing.calculation) {
          updateTaxSummary(result.filing.calculation);
        }
      } catch (error) {
        showNotification('Error uploading file: ' + error.message, 'error');
      }
    }
  });

  // Generate Report button functionality - MOVED OUTSIDE OF FILE UPLOAD HANDLER
  const generateReportBtn = document.querySelector('.btn-block');
  if (generateReportBtn && generateReportBtn.textContent.includes('Generate')) {
    generateReportBtn.addEventListener('click', async function() {
      try {
        // Get the latest filing
        const filings = await getFilings();
        if (filings.success && filings.filings.length > 0) {
          const latestFilingId = filings.filings[filings.filings.length - 1].id;
          await generateReport(latestFilingId);
        } else {
          showNotification('No filing data available. Please upload sales data first.', 'warning');
        }
      } catch (error) {
        showNotification('Error generating report: ' + error.message, 'error');
      }
    });
  }
 
  // AI Assistant functionality
  const askButton = document.querySelector('.card:last-child .btn');
  const questionInput = document.querySelector('.card:last-child input[type="text"]');
 
  if (askButton && questionInput) {
    // Handle button click
    askButton.addEventListener('click', handleAssistantQuestion);
   
    // Also handle Enter key in the input field
    questionInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        handleAssistantQuestion();
      }
    });
  }
 
  async function handleAssistantQuestion() {
    const question = questionInput.value.trim();
    if (question) {
      try {
        showNotification('Asking AI assistant...', 'info');
        const response = await askAssistant(question);
        showNotification(`AI Assistant: ${response.answer}`, 'info');
       
        // Clear the input field after successful question
        questionInput.value = '';
      } catch (error) {
        showNotification('Error getting response from assistant: ' + error.message, 'error');
      }
    } else {
      showNotification('Please enter a question', 'warning');
    }
  }
});

// The rest of your functions (updateTaxSummary, showNotification, etc.) remain the same
function updateTaxSummary(calculation) {
  // This function would update the UI with the tax calculation results
  const totalSalesEl = document.querySelector('.summary-item:nth-child(1) .summary-value');
  if (totalSalesEl) {
    totalSalesEl.textContent = `₹${calculation.totalSales.toLocaleString()}`;
  }
 
  const cgstEl = document.querySelector('.summary-item:nth-child(2) .summary-value');
  if (cgstEl) {
    cgstEl.textContent = `₹${calculation.cgst.toFixed(2)}`;
  }
 
  const sgstEl = document.querySelector('.summary-item:nth-child(3) .summary-value');
  if (sgstEl) {
    sgstEl.textContent = `₹${calculation.sgst.toFixed(2)}`;
  }
 
  const totalPayableEl = document.querySelector('.summary-item:nth-child(4) .summary-value');
  if (totalPayableEl) {
    totalPayableEl.textContent = `₹${calculation.totalTax.toFixed(2)}`;
  }
 
  console.log('Tax calculation:', calculation);
}
 
function showNotification(message, type = 'info') {
  // Remove any existing notifications first
  const existingNotifications = document.querySelectorAll('.notification');
  existingNotifications.forEach(notification => notification.remove());
 
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">&times;</button>
  `;
 
  // Add styles if not already added
  if (!document.querySelector('#notification-styles')) {
    const styles = document.createElement('style');
    styles.id = 'notification-styles';
    styles.textContent = `
      .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
        max-width: 400px;
      }
      .notification-success { background-color: #27ae60; }
      .notification-error { background-color: #e74c3c; }
      .notification-warning { background-color: #f39c12; }
      .notification-info { background-color: #3498db; }
      .notification button {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        margin-left: 10px;
      }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styles);
  }
 
  document.body.appendChild(notification);
 
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}




const express = require('express');
const path = require('path');
const app = express();
 
// Middleware for form data + JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
 
// Serve static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));
 
// GET route for settings page
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'settings.html'));
});
 
// POST route for saving settings
app.post('/settings', (req, res) => {
  console.log('Received settings:', req.body);
 
  // Example: Save settings to a JSON file (instead of a DB)
  // You can replace this with DB code if needed
  const fs = require('fs');
  fs.writeFileSync('user-settings.json', JSON.stringify(req.body, null, 2));
 
  res.send('Settings saved successfully!');
});
 
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
 