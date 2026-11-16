import type { NextConfig } from 'next';

if (process.env.APP_MODE && process.env.APP_MODE !== 'synthetic') {
  throw new Error('Only synthetic deployments are supported. Live mode requires a reviewed practice-system adapter and security configuration.');
}

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {source:'/:path*',headers:[
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Referrer-Policy',value:'no-referrer'},
        {key:'X-Frame-Options',value:'DENY'},
        {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
      ]},
      {source:'/api/:path*',headers:[{key:'Cache-Control',value:'no-store, private'}]},
    ];
  },
};

export default config;
