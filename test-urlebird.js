import https from 'https';

https.get('https://urlebird.com/hash/nigerianmemes/', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
}, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Status HTTP', res.statusCode);
        const videoLinks = [...new Set(Array.from(data.matchAll(/href="(https:\/\/urlebird\.com\/video\/.*?)"/g)).map(m => m[1]))];
        console.log('Found video pages:', videoLinks.length);
        if (videoLinks.length > 0) console.log(videoLinks.slice(0, 3));
    });
}).on('error', err => console.error(err.message));
