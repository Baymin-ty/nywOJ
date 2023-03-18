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
});