const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  productionSourceMap: false,
  devServer: {
    proxy: {
      '/api': {
        target: "http://127.0.0.1:1234",
        ws: true,
        changeOrigin: true
      }
    }
  },
  chainWebpack(config) {
    if (process.env.NODE_ENV === 'production') {
      config.optimization.splitChunks({
        cacheGroups: {
          common: {
            name: 'ty',
            chunks: 'all',
            // minChunks: 1,
            // minSize: 300000,
            // maxSize: 500000,
            // priority: 1,
            // reuseExistingChunk: true
          },
        }
      })
    }
  }
});