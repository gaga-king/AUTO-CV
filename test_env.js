import 'dotenv/config';
console.log('--- Env Keys ---');
console.log('process.env.OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY ? `${process.env.OPENROUTER_API_KEY.substring(0,6)}...${process.env.OPENROUTER_API_KEY.slice(-4)}` : 'undefined');
console.log('process.env.OPENROUTER_BASE_URL:', process.env.OPENROUTER_BASE_URL);
console.log('process.env.OPENROUTER_MODEL:', process.env.OPENROUTER_MODEL);
console.log('process.env.GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'present' : 'empty');
