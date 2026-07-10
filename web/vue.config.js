const { defineConfig } = require('@vue/cli-service')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
module.exports = defineConfig({
  publicPath: process.env.NODE_ENV === 'production'
    ? '/'
    : '/',
  transpileDependencies: true,
  productionSourceMap: false,
  css: {
    extract: {
      ignoreOrder: true,
    },
  },
  devServer: {
    client: {
      overlay: {
        warnings: true,
        errors: true,
        runtimeErrors: (error) => {
          const message = error && error.message ? error.message : String(error || '');
          return !message.includes('ResizeObserver loop');
        },
      },
    },
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: "http://127.0.0.1:1234",
        ws: true,
        changeOrigin: true,
        proxyTimeout: 10 * 60 * 1000,
        timeout: 10 * 60 * 1000
      }
    }
  },
  chainWebpack(config) {
    if (process.env.NODE_ENV === 'production') {
      config.optimization.splitChunks({
        chunks: 'all',
        maxInitialRequests: 12,
        maxAsyncRequests: 20,
        cacheGroups: {
          elementPlus: {
            test: /[\\/]node_modules[\\/]element-plus[\\/]/,
            name: 'element-plus',
            chunks: 'all',
            priority: 40,
          },
          monacoEditor: {
            test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
            name: 'monaco-editor',
            chunks: 'async',
            priority: 35,
          },
          markdown: {
            test: /[\\/]node_modules[\\/](@kangc[\\/]v-md-editor|codemirror|highlight.js|markdown-it|xss)[\\/]/,
            name: 'markdown',
            chunks: 'async',
            priority: 30,
          },
          echarts: {
            test: /[\\/]node_modules[\\/]echarts[\\/]/,
            name: 'echarts',
            chunks: 'async',
            priority: 25,
          },
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: -10,
          },
          common: {
            minChunks: 2,
            minSize: 30 * 1024,
            name: 'common',
            chunks: 'all',
            priority: -20,
            reuseExistingChunk: true,
          },
        }
      })
    }
  },
  configureWebpack: {
    plugins: [
      new MonacoWebpackPlugin({
        languages: ['cpp', 'python'],
        features: [
          '!accessibilityHelp',
          '!anchorSelect',
          '!codeAction',
          '!codelens',
          '!colorPicker',
          '!documentSymbols',
          '!dropIntoEditor',
          '!fontZoom',
          '!format',
          '!gotoError',
          '!gotoLine',
          '!gotoSymbol',
          '!inlayHints',
          '!inlineCompletions',
          '!inlineProgress',
          '!inspectTokens',
          '!linkedEditing',
          '!parameterHints',
          '!quickCommand',
          '!quickHelp',
          '!quickOutline',
          '!referenceSearch',
          '!rename',
          '!semanticTokens',
          '!stickyScroll',
          '!suggest',
          '!toggleHighContrast',
          '!toggleTabFocusMode',
          '!unicodeHighlighter',
          '!unusualLineTerminators',
        ],
      })
    ]
  }
});
