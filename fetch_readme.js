import https from 'https';
https.get('https://raw.githubusercontent.com/lovartai/lovart-skill/main/README_CN.md', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(data));
});
