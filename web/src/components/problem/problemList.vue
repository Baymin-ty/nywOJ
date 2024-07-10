<template>
  <div style="text-align: center; margin: 0 auto; max-width: 1300px">
    <el-card class="box-card" shadow="hover">
      <template #header>
        <div class="card-header">
          题目列表
          <el-pagination @current-change="handleCurrentChange" :current-page="currentPage" :page-size="20"
            layout="total, prev, pager, next" :total="total"></el-pagination>
          <el-button-group>
            <el-popconfirm v-if="this.gid >= 2" confirm-button-text="确认" cancel-button-text="取消" title="确认添加题目?"
              @confirm="addProblem">
              <template #reference>
                <el-button type="success">
                  <el-icon class="el-icon--left">
                    <Plus />
                  </el-icon>
                  添加题目
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="primary" @click="all">
              <el-icon class="el-icon--left">
                <Refresh />
              </el-icon>
              刷新
            </el-button>
          </el-button-group>
        </div>
      </template>
      <div style="display: inline-flex;">
        <el-form :inline="true" :model="filter">
          <el-form-item>
            <el-input v-model="filter.name" type="text" placeholder="题目标题" style="width: 150px;" @keyup.enter="all" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="filter.publisherUid" type="text" placeholder="出题人uid" style="width: 100px;"
              @keyup.enter="all" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.level" placeholder="难度评级" style="width: 150px;" @change="all">
              <el-option v-for="it in levels" :key="it.index" :label="it.label" :value="it.index" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filter.tags" multiple filterable clearable placeholder="题目标签" style="width: 400px;"
              @change="all">
              <el-option v-for="tag in tagList" :key="tag" :label="tag" :value="tag">
                <el-tag type="info" :color="getTagColor(tag)">
                  <span class="tag-text">{{ tag }} </span>
                </el-tag>
              </el-option>
            </el-select>
          </el-form-item>
        </el-form>
        <el-button-group>
          <el-button type="primary" @click="all">
            筛选记录
          </el-button>
          <el-button type="success" @click="clear">
            显示全部
          </el-button>
        </el-button-group>
      </div>
      <el-table :data="problemList" height="600px" :header-cell-style="{ textAlign: 'center' }" :cell-style="cellStyle"
        v-loading="!finished">
        <el-table-column prop="pid" label="#" width="100px" />
        <el-table-column prop="title" width="auto">
          <template #header>
            <div class="title-container">
              <div class="title-left">标题</div>
              <div class="tags-right">
                <div @click="tagVisible = !tagVisible" class="rlink">{{ tagVisible ? '隐藏' : '显示' }}</div>
                <div>算法标签</div>
              </div>
            </div>
          </template>
          <template #default="scope">
            <div class="title-container">
              <div class="title-left">
                <span class="rlink" @click="this.$router.push('/problem/' + scope.row.pid)">
                  {{ scope.row.title }}
                </span>
                <el-icon id="hidden" v-if="!scope.row.isPublic">
                  <Hide />
                </el-icon>
              </div>
              <div class="tags-right">
                <el-tag v-show="tagVisible" type="info" v-for="tag in scope.row.tags" :key="tag"
                  :color="getTagColor(tag)" @click="queryTag(tag)">
                  <span class="tag-text">{{ tag }} </span>
                </el-tag>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="level" label="难度评级" width="150px">
          <template #default="scope">
            <el-button size="small" :color="levels[scope.row.level]?.color ?? '#BFBFBF'" :dark="true"
              @click="filter.level = scope.row.level, all()">
              <span class="tag-text"> {{ levels[scope.row.level]?.label ?? '未知难度' }} </span>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="AC/提交" width="120px">
          <template #default="scope">
            <span> {{ scope.row.acCnt }} / {{ scope.row.submitCnt }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="发布时间" width="120px" />
        <el-table-column prop="publisher" label="出题人" width="160px">
          <template #default="scope">
            <span class="rlink" @click="this.$router.push('/user/' + scope.row.publisherUid)">
              {{ scope.row.publisher }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import axios from "axios"
import { ElMessage } from 'element-plus'
import qs from 'qs'

export default {
  name: 'problemList',
  data() {
    return {
      problemList: [],
      total: 0,
      gid: 1,
      currentPage: 1,
      finished: false,
      filter: {
        name: null,
        level: null,
        tags: [],
        publisherUid: null
      },
      levels: [
        {
          index: 0,
          label: '暂未评级',
          color: '#BFBFBF'
        },
        {
          index: 1,
          label: '入门',
          color: '#FE4C61'
        },
        {
          index: 2,
          label: '普及',
          color: '#FFC116'
        },
        {
          index: 3,
          label: '提高',
          color: '#52C41A'
        },
        {
          index: 4,
          label: '省选',
          color: '#3498DB'
        },
        {
          index: 5,
          label: 'NOI / NOI+',
          color: '#0E1D69'
        },
        {
          index: 6,
          label: '不限难度',
        },
      ],
      tagColorList: [
        '#2d8cf0',
        '#3f51b5',
        '#9c27b0',
        '#009688',
        '#19be6b',
        '#689f38',
        '#ff9900',
        '#E91E63',
        '#ed4014'
      ],
      tagList: [],
      tagVisible: true,
    }
  },
  methods: {
    all() {
      this.finished = false;
      let param = {}, url = location.pathname;
      if (this.filter.name) param.name = this.filter.name;
      if (this.filter.level) param.level = this.filter.level;
      if (this.filter.publisherUid) param.publisherUid = this.filter.publisherUid;
      if (this.filter.tags?.length) param.tags = JSON.stringify(this.filter.tags);
      if (this.currentPage > 1)
        param.pageId = this.currentPage;
      let nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.state.current = url;
      history.replaceState(history.state, null, url);
      axios.post('/api/problem/getProblemList', {
        pageId: this.currentPage,
        filter: this.filter
      }).then(res => {
        this.problemList = res.data.data;
        this.total = res.data.total;
        this.finished = true;
      }).catch(err => {
        ElMessage({
          message: '获取题目列表失败' + err.message,
          type: 'error',
          duration: 2000,
        });
      });
    },
    handleCurrentChange(val) {
      this.currentPage = val;
      this.all();
    },
    addProblem() {
      axios.post('/api/problem/createProblem').then(res => {
        if (res.status === 200) {
          this.$router.push('/problem/edit/' + res.data.pid);
        } else {
          ElMessage({
            message: '添加题目失败' + res.data.message,
            type: 'error',
            duration: 2000,
          });
        }
      });
    },
    cellStyle({ columnIndex }) {
      return { textAlign: columnIndex === 1 ? 'left' : 'center' };
    },
    clear() {
      this.filter = {
        name: null,
        level: null,
        tags: [],
        publisherUid: null
      };
      this.all();
    },
    hash(str) {
      let t = 0;
      for (let i = 0; i < str.length; i++)
        t = 31 * t + str.charCodeAt(i);
      return t;
    },
    getTagColor(tag) {
      return this.tagColorList[this.hash(tag) % this.tagColorList.length];
    },
    queryTag(tag) {
      let list = this.filter.tags;
      const index = list.indexOf(tag);
      if (index !== -1) {
        list.splice(index, 1);
      } else {
        list.push(tag);
      }
      this.all();
    }
  },
  mounted() {
    axios.post('/api/problem/getProblemTags').then(res => {
      if (res.status === 200) {
        this.tagList = res.data;
        this.tagList = this.tagList.sort((a, b) => {
          return this.hash(a) % this.tagColorList.length - this.hash(b) % this.tagColorList.length;
        });
      } else {
        ElMessage({
          message: '获取题目标签失败' + res.data.message,
          type: 'error',
          duration: 2000,
        });
      }
    });
    this.gid = this.$store.state.gid;
    let query = this.$route.query;
    if (query.name) this.filter.name = query.name;
    if (query.level) this.filter.level = parseInt(query.level);
    if (query.tags) this.filter.tags = JSON.parse(query.tags);
    if (query.publisherUid) this.filter.publisherUid = parseInt(query.publisherUid);
    if (query.pageId) this.currentPage = parseInt(query.pageId);
    this.all();
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.box-card {
  height: auto;
  margin: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 20px;
}

.title-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title-left {
  display: flex;
  align-items: center;
}

.tags-right {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.el-tag {
  cursor: pointer;
  margin-left: 5px;
}

.tag-text {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.el-form--inline .el-form-item {
  margin-right: 15px;
}
</style>