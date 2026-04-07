require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// File upload config
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.tsv', '.txt'].includes(ext)) cb(null, true);
    else cb(new Error('Only CSV/TSV files are supported'));
  }
});

// ─── BUDGET DATA (in-memory store, replace with Google Sheets API later) ─────
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEPT','OCT','NOV','DEC'];
const LOCATIONS = ['LEVEL', 'TITAN', 'TRADEMARK', 'PAPPAS', 'PRO'];

// Budget context for AI classification
const BUDGET_CONTEXT = {
  LEVEL: {
    description: "Level - home services brand",
    vendors: ["SCORPION", "PODIUM", "SERVICE TITAN", "OUTFRONT"],
    mediaTypes: ["DIGITAL", "SOCIAL", "OOH", "DIRECTORY", "TECHNOLOGY", "PRINT", "DIRECT MAIL", "EVENTS", "MERCH"]
  },
  TITAN: {
    description: "Titan - home services brand",
    vendors: ["SCORPION", "PODIUM"],
    mediaTypes: ["DIGITAL", "SOCIAL", "OOH", "DIRECTORY", "TECHNOLOGY", "PRINT", "EVENTS", "MERCH"]
  },
  TRADEMARK: {
    description: "Trademark - home services brand, largest budget",
    vendors: ["SCORPION", "PODIUM"],
    mediaTypes: ["DIGITAL", "SOCIAL", "OOH", "DIRECTORY", "TECHNOLOGY", "PRINT", "DIRECT MAIL", "EVENTS", "MERCH"]
  },
  PAPPAS: {
    description: "Pappas - home services brand",
    vendors: ["SCORPION", "PODIUM"],
    mediaTypes: ["DIGITAL", "SOCIAL", "OOH", "DIRECTORY", "TECHNOLOGY", "PRINT", "DIRECT MAIL", "EVENTS", "MERCH"]
  },
  PRO: {
    description: "Pro - home services brand, highest revenue target ($34M), expanding to Chicago metro",
    vendors: ["SCORPION", "PODIUM", "MARCHEX"],
    mediaTypes: ["DIGITAL", "SOCIAL", "OOH", "DIRECTORY", "TECHNOLOGY", "EVENTS", "MERCH"]
  }
};

// In-memory expense store (replace with DB/Sheets later)
let expenses = [];

// ─── AI CLASSIFICATION ───────────────────────────────────────────────────────
async function classifyExpense(expense) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { branch: 'UNKNOWN', mediaType: 'UNKNOWN', category: 'UNKNOWN', confidence: 0, reasoning: 'No API key configured' };
  }

  const client = new Anthropic();

  const prompt = `You are an expense classifier for USP, a home services company with 5 branches: ${LOCATIONS.join(', ')}.

Here is what each branch looks like:
${Object.entries(BUDGET_CONTEXT).map(([loc, ctx]) => `- ${loc}: ${ctx.description}. Vendors: ${ctx.vendors.join(', ')}. Media types: ${ctx.mediaTypes.join(', ')}`).join('\n')}

Classify this expense into the correct branch, media type, and category.

Expense details:
- Description: ${expense.description || 'N/A'}
- Vendor: ${expense.vendor || 'N/A'}
- Amount: $${expense.amount || 0}
- Date: ${expense.date || 'N/A'}
- Memo/Notes: ${expense.memo || 'N/A'}

Respond in ONLY valid JSON with these fields:
{
  "branch": "one of: LEVEL, TITAN, TRADEMARK, PAPPAS, PRO",
  "mediaType": "one of: DIGITAL, SOCIAL, OOH, DIRECTORY, TECHNOLOGY, BROADCAST, DIRECT MAIL, PRINT, EVENTS, MERCH, OTHER",
  "category": "one of: PROSPECT, ROOFING, ALL, TECHNOLOGY",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation of why this classification"
}

If the vendor name matches a known vendor for a specific branch, classify it there. If the expense mentions a location name or market area, use that. If ambiguous, pick the most likely branch and lower the confidence score.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { branch: 'UNKNOWN', mediaType: 'OTHER', category: 'ALL', confidence: 0, reasoning: 'Could not parse response' };
  } catch (err) {
    console.error('Classification error:', err.message);
    return { branch: 'UNKNOWN', mediaType: 'OTHER', category: 'ALL', confidence: 0, reasoning: err.message };
  }
}

// ─── API ROUTES ──────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

// Classify a single expense
app.post('/api/expenses/classify', async (req, res) => {
  try {
    const { description, vendor, amount, date, memo } = req.body;
    const classification = await classifyExpense({ description, vendor, amount, date, memo });
    res.json(classification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a single expense (manual entry)
app.post('/api/expenses', async (req, res) => {
  try {
    const { description, vendor, amount, date, memo, autoClassify } = req.body;
    let classification = { branch: req.body.branch || 'UNKNOWN', mediaType: req.body.mediaType || 'OTHER', category: req.body.category || 'ALL', confidence: 1, reasoning: 'Manual entry' };

    if (autoClassify !== false) {
      classification = await classifyExpense({ description, vendor, amount, date, memo });
    }

    const expense = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      description,
      vendor,
      amount: parseFloat(amount) || 0,
      date: date || new Date().toISOString().split('T')[0],
      memo,
      ...classification,
      createdAt: new Date().toISOString()
    };

    expenses.push(expense);
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload CSV of expenses and classify each row
app.post('/api/expenses/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const csvText = fs.readFileSync(req.file.path, 'utf8');
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
      return res.status(400).json({ error: 'CSV parse errors', details: parsed.errors.slice(0, 5) });
    }

    const results = [];
    for (const row of parsed.data) {
      // Try to find common CSV column names
      const expense = {
        description: row.description || row.Description || row.DESC || row.name || row.Name || '',
        vendor: row.vendor || row.Vendor || row.VENDOR || row.payee || row.Payee || '',
        amount: parseFloat(row.amount || row.Amount || row.AMOUNT || row.total || row.Total || 0),
        date: row.date || row.Date || row.DATE || row.trans_date || '',
        memo: row.memo || row.Memo || row.notes || row.Notes || row.category || row.Category || ''
      };

      const classification = await classifyExpense(expense);

      const classified = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        ...expense,
        ...classification,
        createdAt: new Date().toISOString()
      };

      expenses.push(classified);
      results.push(classified);
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      total: results.length,
      byBranch: LOCATIONS.reduce((acc, loc) => {
        acc[loc] = results.filter(r => r.branch === loc).length;
        return acc;
      }, {}),
      expenses: results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all expenses (with optional filters)
app.get('/api/expenses', (req, res) => {
  let filtered = [...expenses];
  if (req.query.branch) filtered = filtered.filter(e => e.branch === req.query.branch);
  if (req.query.mediaType) filtered = filtered.filter(e => e.mediaType === req.query.mediaType);
  if (req.query.month) {
    const m = parseInt(req.query.month);
    filtered = filtered.filter(e => new Date(e.date).getMonth() === m);
  }

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const byBranch = {};
  LOCATIONS.forEach(loc => {
    byBranch[loc] = filtered.filter(e => e.branch === loc).reduce((s, e) => s + e.amount, 0);
  });

  res.json({ total, byBranch, count: filtered.length, expenses: filtered });
});

// Update expense classification (manual override)
app.patch('/api/expenses/:id', (req, res) => {
  const expense = expenses.find(e => e.id === req.params.id);
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const allowed = ['branch', 'mediaType', 'category', 'description', 'vendor', 'amount', 'date', 'memo'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) expense[key] = req.body[key];
  });
  expense.confidence = 1;
  expense.reasoning = 'Manual override';

  res.json(expense);
});

// Delete expense
app.delete('/api/expenses/:id', (req, res) => {
  const idx = expenses.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  expenses.splice(idx, 1);
  res.json({ deleted: true });
});

// Reclassify an expense
app.post('/api/expenses/:id/reclassify', async (req, res) => {
  const expense = expenses.find(e => e.id === req.params.id);
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const classification = await classifyExpense(expense);
  Object.assign(expense, classification);
  res.json(expense);
});

// Serve the dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  USP Budget Dashboard running at http://localhost:${PORT}`);
  console.log(`  API Key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET (add to .env)'}\n`);
});
