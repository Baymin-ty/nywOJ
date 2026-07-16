<template>
  <div>
    <el-collapse accordion v-model="active">
      <el-collapse-item v-for="subtask in subtaskInfo" :key="subtask.info.index" :name="subtask.info.index">
        <template #title>
          <div class="case-summary subtask-summary">
          <div class="summary-field">
            <span class="tag">
              Subtask #{{ subtask.info.index }}
            </span>
          </div>
          <div class="summary-field">
            <span v-if="!subtask.info.option" class="tag">
              score: {{ subtask.info.score }} / {{ subtask.info.fullScore }}
            </span>
            <el-tooltip v-if="subtask.info.option" placement="top" effect="light" :content=getExplanation(subtask.info)>
              <span class="tag">
                <el-icon>
                  <InfoFilled />
                </el-icon>
                score: {{ subtask.info.score }} / {{ subtask.info.fullScore }}
              </span>
            </el-tooltip>
          </div>
          <div class="summary-field">
            <span class="tag" :style="{ 'color': resColor[subtask.info.res] }">
              {{ subtask.info.res }}
            </span>
          </div>
          <div class="summary-field">
            <span class="tag">
              time: {{ subtask.info.time }} ms
            </span>
          </div>
          <div class="summary-field">
            <span class="tag">
              memory: {{ subtask.info.memory }}
            </span>
          </div>
          </div>
        </template>
        <div class="sub" :style="{ 'color': resColor[subtask.info.res] }">
          <el-collapse accordion>
            <el-collapse-item :disabled="true" v-for="id in subtask['info']?.dependencies" :key="id">
              <template #title>
                <div class="case-summary nested-summary">
                <div class="summary-field">
                  <span class="tag">
                    Subtask #{{ id }}
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag" :style="{ 'color': resColor[subtaskInfo[id]['info']['res']] }">
                    {{ subtaskInfo[id]['info']['res'] }}
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag">
                    time: {{ subtaskInfo[id]['info']['time'] }} ms
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag">
                    memory: {{ subtaskInfo[id]['info']['memory'] }}
                  </span>
                </div>
                </div>
              </template>
            </el-collapse-item>
            <el-collapse-item v-for="data in subtask['cases']" :key="data.id">
              <template #title>
                <div class="case-summary nested-summary">
                <div class="summary-field">
                  <span class="tag">
                    Case #{{ data.caseId }}
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag" :style="{ 'color': resColor[data.result] }">
                    {{ data.result }}
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag">
                    time: {{ data.time }} ms
                  </span>
                </div>
                <div class="summary-field">
                  <span class="tag">
                    memory: {{ data.memory }}
                  </span>
                </div>
                </div>
              </template>
              <div class="sub" :style="{ 'color': resColor[data.result] }">
                <span class="tag">
                  input
                </span>
                <pre>{{ data.input }}</pre>
                <span class="tag">
                  output
                </span>
                <pre>{{ data.output }}</pre>
                <span class="tag">
                  checker
                </span>
                <pre>{{ data.compareResult }}</pre>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script>
import { resColor } from '@/assets/common'

export default {
  name: "caseDisplay",
  props: {
    subtaskInfo: {
      default: [],
      required: true,
    },
  },
  data() {
    return {
      resColor: resColor,
      active: 1
    }
  },
  methods: {
    getExplanation(info) {
      if (!info?.dependencies?.length)
        return '此Subtask需通过所有测试点才能得分'
      else return `此Subtask需通过所有测试点及 Subtask: ${JSON.stringify(info.dependencies)} 才能得分`
    }
  }
}
</script>

<style scoped>
pre {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  display: block;
  max-height: 160px;
  overflow: auto;
  padding: 10px;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1;
  word-break: break-all;
  word-wrap: break-word;
  color: #333;
  background-color: #f5f5f5;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.el-collapse {
  --el-collapse-header-height: 40px;
}

.el-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.sub {
  padding: 15px;
  border-style: solid;
  border-radius: 5px;
  border-width: 1.5px;
}

.case-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 8px;
}

.nested-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-field {
  min-width: 0;
}

.tag {
  align-items: center;
  display: flex;
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-weight: 600;
  font-size: 13.5px;
  font-feature-settings: "liga" 0, "calt" 0;
  font-variation-settings: normal;
  line-height: 18px;
  letter-spacing: 0px;
  color: #606266;
}

:deep(.el-icon) {
  margin-right: 5px;
}

@media (max-width: 768px) {
  .case-summary,
  .nested-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 8px;
    padding: 6px 0;
  }

  .case-summary .summary-field:first-child {
    grid-column: 1 / -1;
  }

  .sub {
    padding: 10px;
  }

  .tag {
    min-width: 0;
    font-size: 12px;
    line-height: 16px;
    overflow-wrap: anywhere;
  }

  :deep(.el-collapse-item__header) {
    height: auto;
    min-height: 48px;
    line-height: 1.3;
  }
}
</style>
