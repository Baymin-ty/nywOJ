<template>
  <div class="page-wrap page-wrap--md">
    <el-card shadow="hover">
      <template #header>
        <div class="card-header card-header--wrap">
          <span class="card-title">题目列表</span>
          <div class="card-header-right">
            <el-pagination
              small
              @current-change="handleCurrentChange"
              :current-page="currentPage"
              :page-size="20"
              layout="total, prev, pager, next"
              :total="total"
              hide-on-single-page
            />
            <el-button-group>
              <el-popconfirm v-if="gid >= 2" confirm-button-text="确认" cancel-button-text="取消"
                title="确认添加题目?" @confirm="addProblem">
                <template #reference>
                  <el-button type="success" size="small">
                    <el-icon class="el-icon--left"><Plus /></el-icon>添加题目
                  </el-button>
                </template>
              </el-popconfirm>
              <el-button type="primary" size="small" @click="all">
                <el-icon class="el-icon--left"><Refresh /></el-icon>刷新
              </el-button>
            </el-button-group>
          </div>
        </div>
      </template>

      <!-- Filter bar -->
      <div class="filter-bar">
        <el-input v-model="pid" placeholder="pid跳转" style="width:80px"
          @keyup.enter="$router.push('/problem/'+pid)" size="small" />
        <el-input v-model="filter.name" placeholder="题目标题或内容" style="width:150px"
          @keyup.enter="all" size="small" />
        <el-select v-model="filter.publisherUid" filterable clearable placeholder="出题人"
          style="width:130px" @change="all" size="small">
          <el-option v-for="p in publisherList" :key="p.publisher" :label="p.name" :value="p.publisher" />
        </el-select>
        <el-select v-model="filter.level" placeholder="难度" style="width:100px" @change="all" size="small">
          <el-option v-for="it in levels" :key="it.index" :label="it.label" :value="it.index" />
        </el-select>
        <el-select v-model="filter.tags" multiple filterable clearable placeholder="标签"
          style="width:200px" @change="all" size="small">
          <el-option v-for="tag in tagList" :key="tag" :label="tag" :value="tag">
            <el-tag type="info" :color="getTagColor(tag)" size="small">
              <span class="tag-text">{{ tag }}</span>
            </el-tag>
          </el-option>
        </el-select>
        <el-button-group>
          <el-button type="primary" size="small" @click="all">筛选</el-button>
          <el-button type="success" size="small" @click="clear">全部</el-button>
        </el-button-group>
        <el-button plain size="small" round @click="switchTag">
          {{ tagVisible ? '隐藏标签' : '显示标签' }}
        </el-button>
      </div>

      <!-- Table -->
      <div class="table-scroll">
        <el-table
          :data="problemList"
          height="600px"
          :header-cell-style="{ textAlign:'center', background:'#f5f7fa' }"
          :cell-style="cellStyle"
          v-loading="!finished"
          style="width:100%"
        >
          <el-table-column prop="pid" label="#" width="70" align="center" />
          <el-table-column label="标题" min-width="220">
            <template #default="scope">
              <div class="title-cell">
                <div class="title-left">
                  <router-link class="rlink" :to="'/problem/'+scope.row.pid">{{ scope.row.title }}</router-link>
                  <el-icon id="hidden" v-if="!scope.row.isPublic"><Hide /></el-icon>
                </div>
                <div class="tags-right" v-show="tagVisible">
                  <el-tag
                    v-for="tag in scope.row.tags" :key="tag"
                    type="info" :color="getTagColor(tag)"
                    size="small" @click="queryTag(tag)" style="cursor:pointer; margin-left:4px"
                  >
                    <span class="tag-text">{{ tag }}</span>
                  </el-tag>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="难度" width="110" align="center">
            <template #default="scope">
              <el-button size="small" :color="levels[scope.row.level]?.color ?? '#BFBFBF'" :dark="true"
                @click="filter.level=scope.row.level; all()">
                <span class="tag-text">{{ levels[scope.row.level]?.label ?? '未知' }}</span>
              </el-button>
            </template>
          </el-table-column>
          <el-table-column label="AC/提交" width="90" align="center">
            <template #default="scope">{{ scope.row.acCnt }} / {{ scope.row.submitCnt }}</template>
          </el-table-column>
          <el-table-column prop="time" label="发布" width="100" align="center" class-name="hide-on-mobile" />
          <el-table-column label="出题人" width="120" align="center">
            <template #default="scope">
              <router-link class="rlink" :to="'/user/'+scope.row.publisherUid">{{ scope.row.publisher }}</router-link>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script>
import axios from "axios";
import qs from 'qs';

export default {
  name: 'problemList',
  data() {
    return {
      problemList: [], total: 0, gid: 1, pid: '',
      currentPage: 1, finished: false,
      filter: { name: null, level: null, tags: [], publisherUid: null },
      levels: [
        { index: 0, label: '暂未评级', color: '#BFBFBF' },
        { index: 1, label: '入门',     color: '#FE4C61' },
        { index: 2, label: '普及',     color: '#FFC116' },
        { index: 3, label: '提高',     color: '#52C41A' },
        { index: 4, label: '省选',     color: '#3498DB' },
        { index: 5, label: 'NOI/NOI+', color: '#0E1D69' },
        { index: 6, label: '不限难度'  },
      ],
      tagColorList: ['#2d8cf0','#3f51b5','#9c27b0','#009688','#19be6b','#689f38','#ff9900','#E91E63','#ed4014'],
      tagList: [], tagVisible: true, publisherList: [],
    };
  },
  methods: {
    all() {
      this.finished = false;
      let param = {}, url = location.pathname;
      if (this.filter.name) param.name = this.filter.name;
      if (this.filter.level !== null) param.level = this.filter.level;
      if (this.filter.publisherUid) param.publisherUid = this.filter.publisherUid;
      if (this.filter.tags?.length) param.tags = JSON.stringify(this.filter.tags);
      if (this.currentPage > 1) param.pageId = this.currentPage;
      const nurl = qs.stringify(param);
      if (nurl) url += ('?' + nurl);
      history.replaceState(history.state, null, url);
      axios.post('/api/problem/getProblemList', { pageId: this.currentPage, filter: this.filter })
        .then(res => { this.problemList = res.data.data; this.total = res.data.total; this.finished = true; })
        .catch(err => { this.$message.error('获取题目列表失败 ' + err.message); });
    },
    handleCurrentChange(val) { this.currentPage = val; this.all(); },
    addProblem() {
      axios.post('/api/problem/createProblem').then(res => {
        if (res.status === 200) this.$router.push('/problem/edit/' + res.data.pid);
        else this.$message.error('添加题目失败 ' + res.data.message);
      });
    },
    cellStyle({ columnIndex }) {
      return { textAlign: columnIndex === 1 ? 'left' : 'center' };
    },
    clear() {
      this.filter = { name: null, level: null, tags: [], publisherUid: null };
      this.all();
    },
    hash(str) { let t=0; for(let i=0;i<str.length;i++) t=31*t+str.charCodeAt(i); return t; },
    getTagColor(tag) { return this.tagColorList[Math.abs(this.hash(tag)) % this.tagColorList.length]; },
    queryTag(tag) {
      const idx = this.filter.tags.indexOf(tag);
      if (idx !== -1) this.filter.tags.splice(idx, 1); else this.filter.tags.push(tag);
      this.all();
    },
    switchTag() {
      this.tagVisible = !this.tagVisible;
      localStorage.setItem('tagVisible', this.tagVisible);
    },
  },
  mounted() {
    if (localStorage.getItem('tagVisible') !== null)
      this.tagVisible = localStorage.getItem('tagVisible') === 'true';
    axios.post('/api/problem/getProblemTags').then(res => {
      if (res.status === 200) {
        this.tagList = res.data.sort((a,b) =>
          Math.abs(this.hash(a)) % this.tagColorList.length - Math.abs(this.hash(b)) % this.tagColorList.length);
      }
    });
    axios.post('/api/problem/getProblemPublishers').then(res => {
      if (res.status === 200) this.publisherList = res.data;
    });
    this.gid = this.$store.state.gid;
    const q = this.$route.query;
    if (q.name) this.filter.name = q.name;
    if (q.level) this.filter.level = parseInt(q.level);
    if (q.tags)  this.filter.tags  = JSON.parse(q.tags);
    if (q.publisherUid) this.filter.publisherUid = parseInt(q.publisherUid);
    if (q.pageId) this.currentPage = parseInt(q.pageId);
    this.all();
  },
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: bolder;
  color: #3f3f3f;
}
.card-title { font-size: 15px; }
.card-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.table-scroll { overflow-x: auto; }

.title-cell {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.title-left { display: flex; align-items: center; gap: 4px; }
.tags-right  { display: flex; flex-wrap: wrap; gap: 3px; }

@media (max-width: 768px) {
  .filter-bar > * { flex: 1 1 calc(50% - 4px); min-width: 0; }
  .filter-bar .el-input,
  .filter-bar .el-select { width: 100% !important; }
}
</style>
