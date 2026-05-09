const fs = require('fs');
require('dotenv').config({ override: true });

async function transcribeAudio(filePath, mimetype, fileSize) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const audioData = fs.readFileSync(filePath).toString('base64');
  const mime = (mimetype || '').toLowerCase();

  let encoding = 'OGG_OPUS';
  let sampleRate = 48000;
  if (mime.includes('webm'))      { encoding = 'WEBM_OPUS'; sampleRate = 48000; }
  else if (mime.includes('mp3'))  { encoding = 'MP3';       sampleRate = 0;     }
  else if (mime.includes('wav'))  { encoding = 'LINEAR16';  sampleRate = 16000; }
  else if (mime.includes('flac')) { encoding = 'FLAC';      sampleRate = 0;     }

  const config = {
    encoding,
    languageCode: 'ko-KR',
    enableAutomaticPunctuation: true,
    model: 'latest_long',
    diarizationConfig: { enableSpeakerDiarization: true, minSpeakerCount: 2, maxSpeakerCount: 6 }
  };
  if (sampleRate) config.sampleRateHertz = sampleRate;

  const startResp = await fetch(
    `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, audio: { content: audioData } })
    }
  );
  const startJson = await startResp.json();
  if (startJson.error) throw new Error(`STT 오류: ${startJson.error.message}`);

  const opName = startJson.name;
  const startTime = Date.now();
  let opData;
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const opResp = await fetch(
      `https://speech.googleapis.com/v1/operations/${opName}?key=${apiKey}`
    );
    opData = await opResp.json();
    if (opData.done) break;
    if (Date.now() - startTime > 5 * 60 * 1000) {
      throw new Error('STT 처리 시간 초과 (5분). 더 짧은 오디오로 시도하세요.');
    }
  }
  if (opData.error) throw new Error(`STT 오류: ${opData.error.message}`);

  const results = opData.response?.results || [];
  let rawTranscript = '';
  results.forEach(r => {
    const t = r.alternatives?.[0]?.transcript || '';
    if (t) rawTranscript += t + '\n';
  });

  const speakers = [];
  const lastWithWords = [...results].reverse().find(r => r.alternatives?.[0]?.words?.length);
  if (lastWithWords) {
    const words = lastWithWords.alternatives[0].words;
    let cur = null;
    for (const w of words) {
      const tag = w.speakerTag || 0;
      if (!cur || cur.speaker !== tag) {
        if (cur) speakers.push(cur);
        cur = { speaker: tag, text: '' };
      }
      cur.text += (cur.text ? ' ' : '') + w.word;
    }
    if (cur) speakers.push(cur);
  } else {
    speakers.push({ speaker: 1, text: rawTranscript.trim() });
  }

  return {
    transcript: rawTranscript.trim(),
    speakers,
    durationSec: Math.round((fileSize * 8) / (16000 * 8)),
    sizeKB: Math.round(fileSize / 1024)
  };
}

module.exports = { transcribeAudio };
