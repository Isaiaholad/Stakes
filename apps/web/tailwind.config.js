/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#10121a',
        sand: '#f6f1e8',
        coral: '#ef7d3b',
        mint: '#70d6a8',
        mist: '#dae2ef',
        slate: '#202534'
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"Manrope"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 22px 60px rgba(16, 18, 26, 0.18)'
      },
      backgroundImage: {
        app: 'linear-gradient(180deg, rgba(248,246,242,0.76) 0%, rgba(238,242,248,0.88) 100%), radial-gradient(circle at top, rgba(239,125,59,0.24), transparent 38%), url("/media/moneydrops.gif")'
      }
    }
  },
  plugins: []
};
