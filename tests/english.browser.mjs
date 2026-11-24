import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Actual browser chrome under a Korean locale, with intentionally multilingual user data.
export async function verifyEnglishDefaults(page, baseUrl) {
  const cdp = await page.createCDPSession();
  const originalViewport = page.viewport();
  try {
    await cdp.send('Emulation.setLocaleOverride', { locale: 'ko-KR' });
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
    await page.goto(baseUrl); await page.waitForSelector('#auto-layout');
    assert.equal(await page.$eval('html', e => e.lang), 'en', 'The application document must default to English');
    const sessionId = `english-${randomUUID()}`;
    const call = async (tool, args = {}) => {
      const response = await fetch(`${baseUrl}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args }) });
      const reply = await response.json(); assert.equal(response.status, 200, JSON.stringify(reply)); return reply.result;
    };
    const title = '연구 대화 — 日本語';
    const label = '사용자 원문 — ノード';
    const detail = '이 문장과 출처는 자동 번역하지 않습니다。';
    const relation = '설명한다 — 関係';
    const note = '그림에 대한 사용자 메모 — 注記';
    await call('session_open', { title });
    const node = (id, text) => ({ id, kind: 'concept', label: text, detail, status: 'confirmed', sources: [{ kind: 'turn', ref: '원본 대화 위치' }] });
    await call('graph_commit', { baseRevision: 0, answerId: 'multilingual-fixture', nodes: [node('one', label), node('two', '두 번째 내용')], edges: [{ id: 'relation', source: 'one', target: 'two', relation, status: 'active' }] });
    for (const status of ['pending', 'applied', 'needs_clarification', 'rejected']) {
      const feedback = await call('feedback_submit', { baseRevision: 1, note });
      if (status !== 'pending') await call('feedback_ack', { feedbackIds: [feedback.id], status, note: '사용자가 작성한 처리 사유' });
    }
    const original = await call('graph_read'), originalFeedback = await call('feedback_read', { status: 'all' });
    await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('.graph-node');
    await page.waitForFunction(() => document.querySelectorAll('#feedback-list li').length === 4);
    await page.click('[data-node-id="one"]');
    assert.equal(await page.$eval('#title', e => e.textContent), title);
    assert.equal(await page.$eval('#node-label', e => e.value), label);
    assert.equal(await page.$eval('#node-detail', e => e.value), detail);
    assert.ok((await page.$eval('#node-relations', e => e.textContent)).includes(relation));
    assert.equal(await page.$eval('#node-kind', e => e.textContent), 'Concept');
    assert.ok((await page.$eval('#feedback-target', e => e.textContent)).startsWith(`Selected: ${label}`));
    assert.deepEqual((await page.$$eval('#feedback-list strong', all => all.map(e => e.textContent.split(' · ')[0]))).sort(), ['Pending', 'Applied', 'Needs clarification', 'Rejected'].sort());
    assert.equal(await page.$$eval('#feedback-list p', all => all.filter(e => e.textContent === '그림에 대한 사용자 메모 — 注記').length), 4);
    await page.click('#minimap-toggle'); assert.equal(await page.$eval('#minimap-toggle', e => e.textContent), 'Expand');
    await page.click('#minimap-toggle'); assert.equal(await page.$eval('#minimap-toggle', e => e.textContent), 'Collapse');
    await page.click('#history-toggle'); await page.waitForSelector('#history li');
    const history = await page.$eval('#history', e => e.textContent);
    assert.match(history, /\d{1,2}:\d{2}:\d{2}\s(?:AM|PM)/, 'History must use English time formatting even under a Korean locale');
    assert.doesNotMatch(history, /[가-힣]/);
    await page.click('#node-label'); await page.keyboard.press('End'); await page.keyboard.type(' 수정');
    await page.click('[data-node-id="two"]');
    assert.equal(await page.$eval('#node-id', e => e.textContent), 'one');
    assert.equal(await page.$eval('#node-label', e => e.value), `${label} 수정`);
    await page.click('#cancel'); await page.waitForFunction(text => document.getElementById('node-label').value === text, {}, label);
    await page.click('#auto-layout'); await page.waitForSelector('#layout-status[data-state="preview"]');
    assert.match(await page.$eval('#layout-status', e => e.textContent), /Preview/);
    await page.click('#cancel-layout');
    const nonEnglishChrome = await page.evaluate(() => {
      const userContent = '#title, #sessions option:not([value=""]), #nodes .label, #nodes title, #edges .edge-label, #edges title, #sources, #node-relations, #feedback-list p, #feedback-target, #edge-picker option:not([value=""]), #edge-source option:not([value=""]), #edge-target option:not([value=""])';
      const findings = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const n = walker.currentNode; if (!n.parentElement.closest(userContent) && /[가-힣]/.test(n.textContent)) findings.push(n.textContent); }
      for (const e of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
        if (e.closest('#nodes, #edges, #sources')) continue;
        for (const name of ['aria-label', 'title', 'placeholder']) if (/[가-힣]/.test(e.getAttribute(name) ?? '')) findings.push(e.getAttribute(name));
      }
      return findings;
    });
    assert.deepEqual(nonEnglishChrome, [], 'Application chrome and accessible text must be English, excluding user-authored content');
    for (const width of [390, 800]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      assert.equal(await page.$eval('#minimap-toggle', e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }), true);
      const overlap = await page.evaluate(() => {
        const map = document.getElementById('minimap-panel').getBoundingClientRect(), tools = document.querySelector('.canvas-tools').getBoundingClientRect();
        return map.left < tools.right && map.right > tools.left && map.top < tools.bottom && map.bottom > tools.top;
      });
      assert.equal(overlap, false, `Minimap must not cover canvas controls at ${width}px`);
    }
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 }); await page.click('#fit');
    assert.deepEqual(await call('graph_read'), original, 'English UI must not translate or rewrite stored graph data');
    assert.deepEqual(await call('feedback_read', { status: 'all' }), originalFeedback, 'English status labels must not rewrite user feedback');
    return { englishChrome: true, koreanLocale: true, historyTime: true, narrowViewport: true, mediumViewport: true, multilingualDataPreserved: true };
  } finally {
    await cdp.send('Emulation.setLocaleOverride', { locale: '' }); await cdp.detach();
    await page.setViewport(originalViewport);
  }
}
