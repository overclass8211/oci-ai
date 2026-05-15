'use strict';
// =============================================================
// /api/menu — 사이드바 메뉴 조회 (인증된 사용자 누구나)
//   GET /sidebar     visibility=1 인 항목만 순서대로 반환
//                    (Phase 4 에서 RBAC 결합 예정)
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/sidebar', async (req, res) => {
  try {
    const [sections] = await pool.query(
      `SELECT section_key, section_label, display_order
       FROM menu_sections
       WHERE is_visible = 1
       ORDER BY display_order ASC, section_key ASC`
    );
    const [items] = await pool.query(
      `SELECT menu_key, section_key, display_order, label_override
       FROM menu_items
       WHERE is_visible = 1
       ORDER BY section_key ASC, display_order ASC`
    );
    res.json({ success: true, data: { sections, items } });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
