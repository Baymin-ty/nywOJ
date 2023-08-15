<template>
  <div>
    <el-collapse accordion v-model="active">
      <el-collapse-item v-for="subtask in subtaskInfo" :key="subtask.info.index" :name="subtask.info.index">
        <template #title>
          <el-col :span="4">
            <span class="tag">
              Subtask #{{ subtask.info.index }}
            </span>
          </el-col>
          <el-col :span="5">
            <span v-if="!subtask.info.option" class="tag">
              score: {{ subtask.info.score }} / {{ subtask.info.fullScore }}
            </span>
            <el-tooltip v-if="subtask.info.option" content="此Subtask需要通过所有测试点才能得分" placement="top" effect="light">
              <span class="tag">
                <el-icon>
                  <InfoFilled />
                </el-icon>
                score: {{ subtask.info.score }} / {{ subtask.info.fullScore }}
              </span>
            </el-tooltip>
          </el-col>
          <el-col :span="5">
            <span class="tag" :style="{ 'color': resColor[subtask.info.res] }">
              {{ subtask.info.res }}
            </span>
          </el-col>
          <el-col :span="4">
            <span class="tag">
              time: {{ subtask.info.time }} ms
            </span>
          </el-col>
          <el-col :span="4">
            <span class="tag">
              memory: {{ subtask.info.memory }}
            </span>
          </el-col>
        </template>
        <div class="sub" :style="{ 'color': resColor[subtask.info.res] }">
          <el-collapse accordion>
            <el-collapse-item v-for="data in subtask['cases']" :key="data.id">
              <template #title>
                <el-col :span="6">
                  <span class="tag">
                    Case #{{ data.caseId }}
                  </span>
                </el-col>
                <el-col :span="6">
                  <span class="tag" :style="{ 'color': resColor[data.result] }">
                    {{ data.result }}
                  </span>
                </el-col>
                <el-col :span="5">
                  <span class="tag">
                    time: {{ data.time }} ms
                  </span>
                </el-col>
                <el-col :span="5">
                  <span class="tag">
                    memory: {{ data.memory }}
                  </span>
                </el-col>
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

.tag {
  font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-weight: 600;
  font-size: 13.5px;
  font-feature-settings: "liga" 0, "calt" 0;
  font-variation-settings: normal;
  line-height: 18px;
  letter-spacing: 0px;
  color: #606266;
}

.el-icon {
  vertical-align: middle;
}
</style>