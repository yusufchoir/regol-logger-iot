const http = require('http');

const payload = JSON.stringify({id: "rule_1"});
const req = http.request({
  hostname: '172.16.110.127',
  port: 80,
  path: '/api/automation/test',
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response:', data));
});
req.write(payload);
req.end();
