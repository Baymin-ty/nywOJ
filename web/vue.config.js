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
            name: 'chunk-common',
            chunks: 'initial',
            minChunks: 1,
            maxInitialRequests: 5,
            minSize: 0,
            priority: 1,
            reuseExistingChunk: true
          },
          vendors: {
            name: 'chunk-vendors',
            test: /[\\/]node_modules[\\/]/,
            chunks: 'initial',
            maxSize: 100000,
            maxInitialRequests: 20,
            priority: 2,
            reuseExistingChunk: true,
            enforce: true
          },
          antDesignVue: {
            name: 'chunk-ant-design-vue',
            test: /[\\/]node_modules[\\/]ant-design-vue[\\/]/,
            chunks: 'initial',
            priority: 3,
            maxSize: 100000,
            reuseExistingChunk: true,
            enforce: true
          }
        }
      })
    }
  }

});