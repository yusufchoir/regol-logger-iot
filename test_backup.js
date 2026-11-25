const http = require('http');

const payload = JSON.stringify({username: "admin", password: "admin"});
const req = http.request({
  hostname: '172.16.110.127',
  port: 80,
  path: '/api/login',
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const d = JSON.parse(data);
    if(d.token) {
      const req2 = http.request({
        hostname: '172.16.110.127',
        port: 80,
        path: '/api/system/backup',
        method: 'GET',
        headers: { 'X-Auth-Token': d.token }
      }, (res2) => {
        let data2 = '';
        res2.on('data', d => data2 += d);
        res2.on('end', () => console.log(data2));
      });
      req2.end();
    }
  });
});
req.write(payload);
req.end();
