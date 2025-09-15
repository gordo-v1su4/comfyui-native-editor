// api/routes/debug.js
import { Router } from 'express';
export default function makeDebugRouter(getTemplate) {
  const r = Router();
  r.post('/debug/hydrate', async (req, res, next) => {
    try {
      const tpl = getTemplate(); // however you expose the loaded JSON
      const prompt = await buildPromptFromTemplate(tpl, req.body.params || {});
      const keys = Object.keys(prompt);
      const firstKey = keys[0];
      const sample = {
        typeofPrompt: typeof prompt,
        firstKey,
        firstType: typeof prompt[firstKey],
        firstClassType: prompt[firstKey]?.class_type ?? null,
        anyStringNodes: keys.filter(k => typeof prompt[k] === 'string').slice(0, 10),
      };
      res.json(sample);
    } catch (e) { next(e); }
  });
  return r;
}