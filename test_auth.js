const http = require('http');

const authPayload = JSON.stringify({username: "admin", password: "password"}); // Try 'password'
const authReq = http.request({
  hostname: '172.16.110.127',
  port: 80,
  path: '/api/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(authPayload) }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Auth:', data));
});
authReq.write(authPayload);
authReq.end();
