const fs = require('fs');
const html = fs.readFileSync('D:\\wangzhan\\127.0.0.1\\sign_page_last.html', 'utf8');

// Extract NUXT data
const nuxtMatch = html.match(/window\.__NUXT__=\(function\(.*?\)\{return (.+?)\}\)\(window\.__NUXT__\.config=/s);
if (nuxtMatch) {
    console.log('NUXT data found, length:', nuxtMatch[1].length);
    
    // Try to safely extract object structure by looking for keys
    const data = nuxtMatch[1];
    
    // Find all top-level keys
    const keys = [...data.matchAll(/"(\w+)":/g)].map(m => m[1]);
    console.log('Top-level keys:', [...new Set(keys)].slice(0, 30));
    
    // Search for sign-related content
    if (data.includes('sign') || data.includes('签到')) {
        console.log('Found sign-related content in NUXT data');
        
        // Extract snippets around sign
        const signIndices = [];
        let idx = data.indexOf('sign');
        while (idx !== -1) {
            signIndices.push(idx);
            idx = data.indexOf('sign', idx + 1);
        }
        console.log(`Found 'sign' ${signIndices.length} times`);
        
        signIndices.slice(0, 5).forEach(i => {
            console.log('Snippet:', data.substring(Math.max(0, i - 50), i + 50));
        });
    }
    
    // Search for URLs
    const urls = [...data.matchAll(/"(https?:\/\/[^"]+)"/g)].map(m => m[1]);
    console.log('\nURLs in NUXT data:');
    [...new Set(urls)].slice(0, 20).forEach(u => console.log(' ', u));
    
    // Search for API paths
    const paths = [...data.matchAll(/"(\/[^"]*(?:api|medal|sign|user)[^"]*)"/g)].map(m => m[1]);
    console.log('\nAPI-like paths:');
    [...new Set(paths)].slice(0, 20).forEach(p => console.log(' ', p));
} else {
    console.log('NUXT data not found');
}

// Also search the entire HTML for any JS file references
const jsRefs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log('\nJS references in HTML:');
[...new Set(jsRefs)].forEach(j => console.log(' ', j));
