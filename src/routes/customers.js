const router = require('express').Router();
const fs     = require('fs');
const pool   = require('../db');
const upload = require('../middleware/upload');
const { handleError } = require('../middleware/errorHandler');
const { getUserId }   = require('../middleware/auth');
const {
  genAI, MODEL_FAST, SAFETY_SETTINGS, logTokenUsage, runStream, sseStart, sseError, friendlyError
} = require('../services/gemini');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM customers ORDER BY name');
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const { name, region, country, industry, contact_person, phone, email, address } = req.body;
    const [result] = await pool.query(
      `INSERT INTO customers (name, region, country, industry, contact_person, phone, email, address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [name, region || '국내', country || null, industry || null,
       contact_person || null, phone || null, email || null, address || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

// 명함 OCR
router.post('/ocr', upload.array('cards', 20), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ success: false, error: 'GEMINI_API_KEY가 .env에 설정되지 않았습니다.' });
  }
  if (!req.files || !req.files.length) {
    return res.status(400).json({ success: false, error: '파일이 없습니다.' });
  }

  const ocrModel = genAI.getGenerativeModel({
    model: MODEL_FAST,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  const ocrPrompt = `이 명함 이미지에서 정보를 추출해 JSON으로만 반환하세요. 값이 명확히 보이지 않는 필드는 null로 표기.
JSON 형식: {"name":"회사명","contact_person":"이름","industry":"산업군 추정","phone":"전화번호","email":"이메일","address":"주소","region":"국내|해외","country":"국가명","title":"직책"}`;

  const results = [];
  for (const file of req.files) {
    try {
      const imageData = fs.readFileSync(file.path).toString('base64');
      const mimeType  = file.mimetype || 'image/jpeg';
      const result    = await ocrModel.generateContent([
        { text: ocrPrompt },
        { inlineData: { mimeType, data: imageData } }
      ]);
      await logTokenUsage('ocr', result.response.usageMetadata, MODEL_FAST, getUserId(req));
      const text = result.response.text();
      let parsed = {};
      try { parsed = JSON.parse(text); } catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (__) {} }
      }
      results.push({ filename: file.originalname, raw_text: text, parsed });
    } catch (err) {
      console.error('OCR error:', err.message);
      results.push({ filename: file.originalname, error: friendlyError(err), parsed: {} });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }
  res.json({ success: true, data: results });
});

// 고객사 인텔리전스
router.get('/:id/intelligence', async (req, res) => {
  let sseStarted = false;
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [leads] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency, created_at, updated_at
       FROM leads WHERE customer_name=? ORDER BY updated_at DESC LIMIT 10`, [customer.name]);
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.content, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id=l.id
       LEFT JOIN team_members t ON a.performed_by=t.id
       WHERE l.customer_name=? ORDER BY a.performed_at DESC LIMIT 10`, [customer.name]);

    const stageMap = { lead:'리드',review:'검토',proposal:'제안',bidding:'입찰',negotiation:'협상',won:'수주',lost:'실주',dropped:'드롭' };

    const prompt = `당신은 OCI의 시니어 영업 전략가입니다.
다음 고객사 정보를 바탕으로 최신 동향 분석과 수주 Kill 전략을 작성해주세요.

## 고객사 정보
- 회사명: ${customer.name}
- 지역: ${customer.region} / ${customer.country || ''}
- 산업: ${customer.industry || '미분류'}
- 주요 연락처: ${customer.contact_person || '미등록'} (${customer.phone || ''} / ${customer.email || ''})

## 영업 이력 (${leads.length}건)
${leads.map(l => `- ${l.project_name} | ${l.business_type} | 단계: ${stageMap[l.stage]||l.stage} | 금액: ${l.expected_amount||0}${l.currency}`).join('\n') || '이력 없음'}

## 최근 활동 (${activities.length}건)
${activities.map(a => `- [${a.activity_type}] ${a.title}: ${(a.content||'').substring(0,80)} (${a.performer||''}, ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '활동 없음'}

다음 형식으로 작성하세요:

## 📊 고객사 현황 분석
(영업 관계 강도, 주요 관심 분야, 의사결정 구조)

## 🌐 최신 동향 & 시장 환경
(해당 산업/지역 트렌드, 예상 수요, 경쟁사 현황)

## ⚔️ 수주 Kill 전략
### 핵심 공략 포인트 3가지
(각 포인트별 구체적 액션 포함)

### 리스크 관리
(예상 장애물과 대응 방안)

## 🎯 즉시 실행 액션 (이번 주)
1.
2.
3.

한국어로 간결하고 실무적으로 작성하세요.`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req), model: MODEL_FAST, max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }] });
  } catch (err) {
    console.error('Customer intelligence error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

module.exports = router;
