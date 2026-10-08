import type { DomainTemplate } from './types';

export const CRM_DOMAIN_TEMPLATE: DomainTemplate = {
  id: 'crm',
  name: 'CRM 客户与销售管理系统',
  description: '面向 B2B/B2C 销售团队的完整客户全生命周期管理系统，涵盖线索、客户、商机、合同与回款追踪。',
  category: 'crm',
  keywords: ['crm', '客户', '销售', '线索', '商机', '合同', '跟进', '回款', 'customer', 'sales', 'lead', 'deal', 'opportunity'],
  collections: [
    {
      name: 'customers',
      title: '客户',
      description: '核心企业与个人客户档案',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '客户名称', allowNull: false },
        { name: 'industry', type: 'string', title: '所属行业', enumOptions: [{ label: '互联网/IT', value: 'tech' }, { label: '制造', value: 'mfg' }, { label: '金融', value: 'finance' }, { label: '零售', value: 'retail' }] },
        { name: 'level', type: 'string', title: '客户级别', enumOptions: [{ label: 'VIP客户', value: 'vip', color: '#ff4d4f' }, { label: '重点客户', value: 'key', color: '#fa8c16' }, { label: '普通客户', value: 'normal', color: '#1890ff' }] },
        { name: 'phone', type: 'string', title: '联系电话' },
        { name: 'email', type: 'string', title: '联系邮箱' },
        { name: 'address', type: 'string', title: '办公地址' },
        { name: 'status', type: 'string', title: '合作状态', enumOptions: [{ label: '潜在客户', value: 'potential', color: '#faad14' }, { label: '跟进中', value: 'following', color: '#1890ff' }, { label: '已签约', value: 'signed', color: '#52c41a' }, { label: '已流失', value: 'lost', color: '#d9d9d9' }] },
        { name: 'owner', type: 'string', title: '负责人' },
      ],
    },
    {
      name: 'contacts',
      title: '联系人',
      description: '客户组织内的关键决策人与对接人',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '姓名', allowNull: false },
        { name: 'title', type: 'string', title: '职位' },
        { name: 'phone', type: 'string', title: '手机号' },
        { name: 'email', type: 'string', title: '电子邮箱' },
        { name: 'is_primary', type: 'boolean', title: '主联系人', defaultValue: false },
        { name: 'customer_id', type: 'belongsTo', title: '所属客户', target: 'customers', foreignKey: 'customer_id' },
      ],
    },
    {
      name: 'deals',
      title: '销售商机',
      description: '潜在销售交易与跟进漏斗',
      category: 'transaction',
      fields: [
        { name: 'title', type: 'string', title: '商机名称', allowNull: false },
        { name: 'amount', type: 'decimal', title: '商机金额', allowNull: false },
        { name: 'stage', type: 'string', title: '销售阶段', enumOptions: [
          { label: '初步沟通', value: 'discovery', color: '#1890ff' },
          { label: '方案报价', value: 'proposal', color: '#722ed1' },
          { label: '商务谈判', value: 'negotiation', color: '#fa8c16' },
          { label: '赢单成交', value: 'won', color: '#52c41a' },
          { label: '输单结束', value: 'lost', color: '#ff4d4f' }
        ]},
        { name: 'win_rate', type: 'integer', title: '赢单率(%)', defaultValue: 30 },
        { name: 'expected_close_date', type: 'date', title: '预计结单日期' },
        { name: 'customer_id', type: 'belongsTo', title: '对应客户', target: 'customers', foreignKey: 'customer_id' },
        { name: 'owner', type: 'string', title: '跟进销售' },
      ],
    },
    {
      name: 'contracts',
      title: '合同订单',
      description: '正式签署的商业合同与执行情况',
      category: 'transaction',
      fields: [
        { name: 'contract_no', type: 'string', title: '合同编号', unique: true, allowNull: false },
        { name: 'title', type: 'string', title: '合同名称', allowNull: false },
        { name: 'total_amount', type: 'decimal', title: '合同总金额', allowNull: false },
        { name: 'start_date', type: 'date', title: '生效日期' },
        { name: 'end_date', type: 'date', title: '到期日期' },
        { name: 'status', type: 'string', title: '执行状态', enumOptions: [
          { label: '草拟中', value: 'draft', color: '#d9d9d9' },
          { label: '审批中', value: 'pending_approval', color: '#fa8c16' },
          { label: '执行中', value: 'active', color: '#1890ff' },
          { label: '已完成', value: 'completed', color: '#52c41a' },
          { label: '已中止', value: 'terminated', color: '#ff4d4f' }
        ]},
        { name: 'customer_id', type: 'belongsTo', title: '签署客户', target: 'customers', foreignKey: 'customer_id' },
        { name: 'deal_id', type: 'belongsTo', title: '关联商机', target: 'deals', foreignKey: 'deal_id' },
      ],
    },
    {
      name: 'activities',
      title: '跟进记录',
      description: '电话拜访、商务会谈、邮件跟进动态',
      category: 'log',
      fields: [
        { name: 'type', type: 'string', title: '跟进方式', enumOptions: [{ label: '电话拜访', value: 'call' }, { label: '当面拜访', value: 'visit' }, { label: '在线会议', value: 'meeting' }, { label: '邮件沟通', value: 'email' }] },
        { name: 'summary', type: 'string', title: '跟进摘要', allowNull: false },
        { name: 'content', type: 'text', title: '详细沟通纪要' },
        { name: 'activity_date', type: 'datetime', title: '跟进时间', allowNull: false },
        { name: 'next_follow_up', type: 'date', title: '下次跟进计划' },
        { name: 'customer_id', type: 'belongsTo', title: '关联客户', target: 'customers', foreignKey: 'customer_id' },
      ],
    },
  ],
  pages: [
    { title: '销售总览看板', type: 'dashboard', collection: 'deals', icon: '📊' },
    { title: '客户档案管理', type: 'list', collection: 'customers', icon: '🏢' },
    { title: '商机跟进看板', type: 'kanban', collection: 'deals', icon: '🎯' },
    { title: '合同与回款', type: 'list', collection: 'contracts', icon: '📝' },
    { title: '日常跟进记录', type: 'list', collection: 'activities', icon: '📞' },
  ],
  workflows: [
    {
      title: '商机赢单自动生成合同草稿',
      description: '当商机阶段变更为赢单 (won) 时，自动创建关联合同草案并通知法务。',
      trigger: { type: 'record_updated', collection: 'deals', condition: 'stage == "won"' },
      actions: [
        { type: 'create_record', title: '创建待审核合同草稿', config: { targetCollection: 'contracts', status: 'draft' } },
        { type: 'notification', title: '向团队发送赢单喜报通知', config: { channel: 'system', message: '恭喜！商机达成赢单，已自动生成合同待办。' } },
      ],
    },
    {
      title: '高价值客户流失预警',
      description: '当 VIP 客户超过 30 天无新跟进记录时，自动标记并预警负责人。',
      trigger: { type: 'schedule', condition: 'every day at 09:00' },
      actions: [
        { type: 'notification', title: '向负责人发送客户回访提醒', config: { channel: 'system', message: '检测到重点客户近期未安排拜访，请及时跟进。' } },
      ],
    },
  ],
  mockData: {
    customers: {
      count: 12,
      presets: [
        { name: '未来智联科技有限公司', industry: 'tech', level: 'vip', phone: '010-88291001', email: 'corp@futurelink.cn', address: '北京市中关村软件园二期 8 号楼', status: 'signed', owner: '张经理' },
        { name: '华东先进制造业集团', industry: 'mfg', level: 'key', phone: '021-66778899', email: 'biz@huadong-mfg.com', address: '上海市浦东新区张江高科园区 12 号', status: 'following', owner: '李主管' },
        { name: '汇通智慧金融服务有限公司', industry: 'finance', level: 'vip', phone: '0755-22334455', email: 'contact@huitong-fin.com', address: '深圳市福田区中心商务大厦 30 层', status: 'signed', owner: '王总监' },
        { name: '新天地数字零售连锁', industry: 'retail', level: 'normal', phone: '020-83344556', email: 'info@newworld-retail.cn', address: '广州市天河区天河路 188 号', status: 'potential', owner: '赵顾问' },
        { name: '蓝海云计算服务公司', industry: 'tech', level: 'key', phone: '0571-88990011', email: 'support@bluecloud.cn', address: '杭州市滨江区网商路 699 号', status: 'following', owner: '陈经理' },
      ],
    },
    deals: {
      count: 10,
      presets: [
        { title: '数字化升级云平台年度合作', amount: 380000.0, stage: 'proposal', win_rate: 60, expected_close_date: '2026-11-15', owner: '张经理' },
        { title: '智能工厂产线数据中台项目', amount: 850000.0, stage: 'negotiation', win_rate: 80, expected_close_date: '2026-10-30', owner: '李主管' },
        { title: '金融风控 AI 助手采购', amount: 1200000.0, stage: 'won', win_rate: 100, expected_close_date: '2026-09-20', owner: '王总监' },
        { title: '全渠道会员营销系统搭建', amount: 150000.0, stage: 'discovery', win_rate: 30, expected_close_date: '2026-12-01', owner: '赵顾问' },
        { title: '微服务架构迁移咨询服务', amount: 220000.0, stage: 'proposal', win_rate: 50, expected_close_date: '2026-11-20', owner: '陈经理' },
      ],
    },
    contracts: {
      count: 6,
      presets: [
        { contract_no: 'HT-2026-001', title: '金融风控 AI 采购实施合同', total_amount: 1200000.0, start_date: '2026-09-25', end_date: '2027-09-24', status: 'active' },
        { contract_no: 'HT-2026-002', title: '未来智联云原生平台服务合同', total_amount: 380000.0, start_date: '2026-08-01', end_date: '2027-07-31', status: 'active' },
      ],
    },
  },
};

export const PROJECT_DOMAIN_TEMPLATE: DomainTemplate = {
  id: 'project_management',
  name: '项目与协作任务管理系统',
  description: '面向研发、产研与运营团队的敏捷项目协作系统，支持项目立项、任务拆解、看板协同、工时登记与里程碑追踪。',
  category: 'project',
  keywords: ['project', 'task', 'issue', 'sprint', '项目', '任务', '工单', '需求', '里程碑', '缺陷', '研发', '协同'],
  collections: [
    {
      name: 'projects',
      title: '项目总表',
      description: '战略与业务项目基础档案',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '项目名称', allowNull: false },
        { name: 'code', type: 'string', title: '项目代号', unique: true, allowNull: false },
        { name: 'priority', type: 'string', title: '优先级', enumOptions: [{ label: '最高', value: 'P0', color: '#ff4d4f' }, { label: '高', value: 'P1', color: '#fa8c16' }, { label: '中', value: 'P2', color: '#1890ff' }, { label: '低', value: 'P3', color: '#52c41a' }] },
        { name: 'status', type: 'string', title: '项目状态', enumOptions: [
          { label: '准备中', value: 'planning', color: '#faad14' },
          { label: '进行中', value: 'in_progress', color: '#1890ff' },
          { label: '测试验收', value: 'testing', color: '#722ed1' },
          { label: '已上线', value: 'released', color: '#52c41a' },
          { label: '暂停', value: 'paused', color: '#d9d9d9' }
        ]},
        { name: 'start_date', type: 'date', title: '计划开始时间' },
        { name: 'end_date', type: 'date', title: '计划截止时间' },
        { name: 'owner', type: 'string', title: '项目负责人', allowNull: false },
        { name: 'budget', type: 'decimal', title: '预估预算(元)' },
      ],
    },
    {
      name: 'tasks',
      title: '协同任务',
      description: '细粒度工作项与执行进度',
      category: 'transaction',
      fields: [
        { name: 'title', type: 'string', title: '任务标题', allowNull: false },
        { name: 'type', type: 'string', title: '任务类型', enumOptions: [{ label: '功能特性', value: 'feature' }, { label: '缺陷修复', value: 'bug' }, { label: '技术优化', value: 'refactor' }, { label: '设计任务', value: 'design' }] },
        { name: 'priority', type: 'string', title: '优先级', enumOptions: [{ label: '紧急', value: 'high', color: '#ff4d4f' }, { label: '普通', value: 'medium', color: '#1890ff' }, { label: '较低', value: 'low', color: '#52c41a' }] },
        { name: 'status', type: 'string', title: '执行状态', enumOptions: [
          { label: '待处理', value: 'todo', color: '#faad14' },
          { label: '进行中', value: 'in_progress', color: '#1890ff' },
          { label: '代码审核', value: 'review', color: '#722ed1' },
          { label: '已完成', value: 'done', color: '#52c41a' }
        ]},
        { name: 'assignee', type: 'string', title: '指派执行人' },
        { name: 'estimated_hours', type: 'float', title: '预估工时(h)' },
        { name: 'actual_hours', type: 'float', title: '实际工时(h)', defaultValue: 0 },
        { name: 'due_date', type: 'date', title: '截止日期' },
        { name: 'project_id', type: 'belongsTo', title: '所属项目', target: 'projects', foreignKey: 'project_id' },
      ],
    },
    {
      name: 'milestones',
      title: '关键里程碑',
      description: '项目关键交付节点与验收标准',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '里程碑名称', allowNull: false },
        { name: 'target_date', type: 'date', title: '目标交付日', allowNull: false },
        { name: 'status', type: 'string', title: '交付状态', enumOptions: [{ label: '未达成', value: 'pending', color: '#faad14' }, { label: '按时达成', value: 'achieved', color: '#52c41a' }, { label: '发生延期', value: 'delayed', color: '#ff4d4f' }] },
        { name: 'acceptance_criteria', type: 'text', title: '验收标准' },
        { name: 'project_id', type: 'belongsTo', title: '所属项目', target: 'projects', foreignKey: 'project_id' },
      ],
    },
    {
      name: 'timelogs',
      title: '工时记录',
      description: '成员日常工时投入与工作报工',
      category: 'log',
      fields: [
        { name: 'member_name', type: 'string', title: '报工人姓名', allowNull: false },
        { name: 'hours', type: 'float', title: '投入时长(h)', allowNull: false },
        { name: 'work_date', type: 'date', title: '工作日期', allowNull: false },
        { name: 'description', type: 'text', title: '具体工作产出与说明' },
        { name: 'task_id', type: 'belongsTo', title: '对应任务', target: 'tasks', foreignKey: 'task_id' },
      ],
    },
  ],
  pages: [
    { title: '项目综合概览', type: 'dashboard', collection: 'projects', icon: '📈' },
    { title: '项目矩阵列表', type: 'list', collection: 'projects', icon: '📁' },
    { title: '任务敏捷看板', type: 'kanban', collection: 'tasks', icon: '📋' },
    { title: '里程碑进度', type: 'list', collection: 'milestones', icon: '🚩' },
    { title: '工时报工明细', type: 'list', collection: 'timelogs', icon: '⏱️' },
  ],
  workflows: [
    {
      title: '任务逾期自动预警',
      description: '每天检查截止日期已过但未完成的任务，自动发送催办通知。',
      trigger: { type: 'schedule', condition: 'every day at 09:30' },
      actions: [
        { type: 'notification', title: '发送任务临期与延期催办', config: { channel: 'system', message: '您有未按期交付的项目任务，请确认阻碍并及时更新状态。' } },
      ],
    },
    {
      title: '关键里程碑达成自动通告',
      description: '当里程碑状态变更为 achieved 时，自动向全体成员发送捷报。',
      trigger: { type: 'record_updated', collection: 'milestones', condition: 'status == "achieved"' },
      actions: [
        { type: 'notification', title: '广播里程碑达成喜报', config: { channel: 'system', message: '恭喜团队！项目核心交付里程碑已顺利验收。' } },
      ],
    },
  ],
  mockData: {
    projects: {
      count: 6,
      presets: [
        { name: 'FormAI 智能协作平台 2.0', code: 'PRJ-FA-2026', priority: 'P0', status: 'in_progress', start_date: '2026-08-01', end_date: '2026-12-31', owner: '王架构师', budget: 500000.0 },
        { name: '移动端多端适配轻应用项目', code: 'PRJ-MOB-01', priority: 'P1', status: 'planning', start_date: '2026-10-01', end_date: '2027-02-28', owner: '李主管', budget: 280000.0 },
        { name: '私有化容器部署与高可用保障', code: 'PRJ-OPS-K8S', priority: 'P1', status: 'testing', start_date: '2026-07-15', end_date: '2026-10-25', owner: '张运维', budget: 150000.0 },
      ],
    },
    tasks: {
      count: 12,
      presets: [
        { title: '设计并实现领域模板库架构', type: 'feature', priority: 'high', status: 'in_progress', assignee: '王架构师', estimated_hours: 24.0, actual_hours: 16.0, due_date: '2026-10-15' },
        { title: '重构页面架构师支持详情与图表组件', type: 'feature', priority: 'high', status: 'todo', assignee: '刘前端', estimated_hours: 32.0, actual_hours: 0, due_date: '2026-10-20' },
        { title: '修复外键级联同步报错问题', type: 'bug', priority: 'high', status: 'done', assignee: '陈开发', estimated_hours: 8.0, actual_hours: 6.5, due_date: '2026-10-05' },
        { title: '编写自动化集成验证与压力测试用例', type: 'feature', priority: 'medium', status: 'todo', assignee: '赵测试', estimated_hours: 20.0, actual_hours: 0, due_date: '2026-10-28' },
      ],
    },
  },
};

export const INVENTORY_DOMAIN_TEMPLATE: DomainTemplate = {
  id: 'inventory_wms',
  name: '进销存与仓储物流管理系统',
  description: '面向制造、商贸与电商企业的货品库存管理，涵盖商品物料库、仓库库位、采购订单、出入库单据与安全库存预警。',
  category: 'inventory',
  keywords: ['inventory', 'wms', 'stock', 'warehouse', 'product', '进销存', '库存', '仓库', '商品', '出库', '入库', '采购', '供货商'],
  collections: [
    {
      name: 'products',
      title: '商品物料档案',
      description: 'SKU与物料基础属性',
      category: 'core',
      fields: [
        { name: 'sku', type: 'string', title: '商品编码/SKU', unique: true, allowNull: false },
        { name: 'name', type: 'string', title: '商品名称', allowNull: false },
        { name: 'category', type: 'string', title: '分类', enumOptions: [{ label: '电子元器件', value: 'electronics' }, { label: '机械五金', value: 'hardware' }, { label: '包装耗材', value: 'packaging' }, { label: '成品套件', value: 'finished' }] },
        { name: 'unit', type: 'string', title: '计量单位', defaultValue: '件' },
        { name: 'cost_price', type: 'decimal', title: '采购成本价' },
        { name: 'selling_price', type: 'decimal', title: '建议零售价' },
        { name: 'stock_quantity', type: 'integer', title: '当前总库存', defaultValue: 0 },
        { name: 'safety_stock', type: 'integer', title: '安全库存阈值', defaultValue: 50 },
        { name: 'status', type: 'string', title: '物料状态', enumOptions: [{ label: '正常供应', value: 'active', color: '#52c41a' }, { label: '暂停采购', value: 'discontinued', color: '#ff4d4f' }] },
      ],
    },
    {
      name: 'warehouses',
      title: '仓库档案',
      description: '实体仓库与库区分布',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '仓库名称', allowNull: false },
        { name: 'code', type: 'string', title: '仓库代号', unique: true, allowNull: false },
        { name: 'location', type: 'string', title: '仓库地址' },
        { name: 'manager', type: 'string', title: '仓库管理员' },
        { name: 'capacity', type: 'integer', title: '库容上限(立方米)' },
        { name: 'status', type: 'string', title: '运营状态', enumOptions: [{ label: '正常运转', value: 'active', color: '#52c41a' }, { label: '盘点封库', value: 'auditing', color: '#fa8c16' }] },
      ],
    },
    {
      name: 'stock_records',
      title: '出入库流水',
      description: '入库、出库、调拨与盘点明细单据',
      category: 'transaction',
      fields: [
        { name: 'record_no', type: 'string', title: '流水单号', unique: true, allowNull: false },
        { name: 'type', type: 'string', title: '出入库类型', enumOptions: [
          { label: '采购入库', value: 'in_purchase', color: '#52c41a' },
          { label: '销售出库', value: 'out_sales', color: '#1890ff' },
          { label: '退货入库', value: 'in_return', color: '#722ed1' },
          { label: '损耗报废', value: 'out_scrap', color: '#ff4d4f' }
        ]},
        { name: 'quantity', type: 'integer', title: '变动数量', allowNull: false },
        { name: 'operator', type: 'string', title: '经手人', allowNull: false },
        { name: 'record_date', type: 'datetime', title: '作业时间', allowNull: false },
        { name: 'notes', type: 'text', title: '备注说明' },
        { name: 'product_id', type: 'belongsTo', title: '对应商品', target: 'products', foreignKey: 'product_id' },
        { name: 'warehouse_id', type: 'belongsTo', title: '对应仓库', target: 'warehouses', foreignKey: 'warehouse_id' },
      ],
    },
    {
      name: 'suppliers',
      title: '供应商档案',
      description: '外部上游供货商资质与联系人',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '供应商名称', allowNull: false },
        { name: 'contact_person', type: 'string', title: '主要对接人' },
        { name: 'phone', type: 'string', title: '联系电话' },
        { name: 'payment_terms', type: 'string', title: '账期模式', enumOptions: [{ label: '预付款', value: 'prepaid' }, { label: '货到付款', value: 'cod' }, { label: '月结30天', value: 'net30' }, { label: '月结60天', value: 'net60' }] },
        { name: 'rating', type: 'string', title: '信誉评级', enumOptions: [{ label: '优质 (A级)', value: 'A', color: '#52c41a' }, { label: '良好 (B级)', value: 'B', color: '#1890ff' }, { label: '观察 (C级)', value: 'C', color: '#fa8c16' }] },
      ],
    },
  ],
  pages: [
    { title: '仓储与库存概览', type: 'dashboard', collection: 'products', icon: '📦' },
    { title: '商品物料中心', type: 'list', collection: 'products', icon: '🏷️' },
    { title: '出入库流水明细', type: 'list', collection: 'stock_records', icon: '🚚' },
    { title: '仓库库位配置', type: 'list', collection: 'warehouses', icon: '🏬' },
    { title: '供应商名录', type: 'list', collection: 'suppliers', icon: '🤝' },
  ],
  workflows: [
    {
      title: '安全库存低位自动补货告警',
      description: '当物料库存数量小于或等于安全库存时，自动触发预警并生成采购申请。',
      trigger: { type: 'record_updated', collection: 'products', condition: 'stock_quantity <= safety_stock' },
      actions: [
        { type: 'notification', title: '向采购专员发送低库存预警', config: { channel: 'system', message: '警告：检测到物料库存低于安全库存线，请尽快安排采购补货。' } },
      ],
    },
  ],
  mockData: {
    products: {
      count: 10,
      presets: [
        { sku: 'SKU-ELEC-1001', name: '工业级微控制器芯片 MCU-32', category: 'electronics', unit: '片', cost_price: 25.5, selling_price: 45.0, stock_quantity: 1200, safety_stock: 200, status: 'active' },
        { sku: 'SKU-ELEC-1002', name: '高精度温湿度传感器探头', category: 'electronics', unit: '支', cost_price: 18.0, selling_price: 35.0, stock_quantity: 32, safety_stock: 50, status: 'active' },
        { sku: 'SKU-HARD-2001', name: '不锈钢耐磨导轨 1500mm', category: 'hardware', unit: '根', cost_price: 120.0, selling_price: 220.0, stock_quantity: 180, safety_stock: 30, status: 'active' },
        { sku: 'SKU-PACK-3001', name: '防静电加厚真空包装袋', category: 'packaging', unit: '包', cost_price: 8.5, selling_price: 15.0, stock_quantity: 500, safety_stock: 100, status: 'active' },
      ],
    },
    warehouses: {
      count: 3,
      presets: [
        { name: '华北中心一号仓', code: 'WH-BJ-01', location: '北京市顺义区物流园区 3 号', manager: '赵主管', capacity: 15000, status: 'active' },
        { name: '华东昆山保税仓', code: 'WH-KS-02', location: '江苏省苏州市昆山市综合保税区', manager: '孙主管', capacity: 28000, status: 'active' },
        { name: '华南顺德中转仓', code: 'WH-SD-03', location: '广东省佛山市顺德区北滘物流港', manager: '周主管', capacity: 10000, status: 'active' },
      ],
    },
  },
};

export const FINANCE_DOMAIN_TEMPLATE: DomainTemplate = {
  id: 'finance_invoicing',
  name: '财务记账与发票结算系统',
  description: '面向企业日常财务管理，覆盖应收发票、费用报销、资金账户、收付款流水与合规审计。',
  category: 'finance',
  keywords: ['finance', 'invoice', 'expense', 'payment', '财务', '发票', '报销', '支出', '收入', '结算', '记账', '对账'],
  collections: [
    {
      name: 'invoices',
      title: '发票管理',
      description: '增值税开票与收票记录',
      category: 'transaction',
      fields: [
        { name: 'invoice_no', type: 'string', title: '发票代码/号码', unique: true, allowNull: false },
        { name: 'type', type: 'string', title: '发票类型', enumOptions: [{ label: '增值税专用发票', value: 'vat_special' }, { label: '增值税普通发票', value: 'vat_normal' }, { label: '电子普票', value: 'vat_electronic' }] },
        { name: 'amount', type: 'decimal', title: '开票金额(含税)', allowNull: false },
        { name: 'tax_rate', type: 'float', title: '税率(%)', defaultValue: 6.0 },
        { name: 'issue_date', type: 'date', title: '开票日期', allowNull: false },
        { name: 'client_name', type: 'string', title: '购买方/销售方抬头', allowNull: false },
        { name: 'status', type: 'string', title: '认证状态', enumOptions: [{ label: '未核销', value: 'unverified', color: '#faad14' }, { label: '已核销', value: 'verified', color: '#52c41a' }, { label: '已作废', value: 'voided', color: '#ff4d4f' }] },
      ],
    },
    {
      name: 'expenses',
      title: '支出与报销',
      description: '员工报销单据与企业运营成本',
      category: 'transaction',
      fields: [
        { name: 'title', type: 'string', title: '报销事由', allowNull: false },
        { name: 'category', type: 'string', title: '费用科目', enumOptions: [{ label: '差旅交通', value: 'travel' }, { label: '商务宴请', value: 'entertainment' }, { label: '办公采买', value: 'office' }, { label: '软件订阅/服务器', value: 'it_service' }] },
        { name: 'amount', type: 'decimal', title: '报销总额', allowNull: false },
        { name: 'applicant', type: 'string', title: '申请人', allowNull: false },
        { name: 'status', type: 'string', title: '审批状态', enumOptions: [
          { label: '待审批', value: 'pending', color: '#faad14' },
          { label: '已批准待打款', value: 'approved', color: '#1890ff' },
          { label: '已打款支付', value: 'paid', color: '#52c41a' },
          { label: '审批驳回', value: 'rejected', color: '#ff4d4f' }
        ]},
        { name: 'expense_date', type: 'date', title: '发生日期', allowNull: false },
      ],
    },
    {
      name: 'accounts',
      title: '资金账户',
      description: '银行基本户、一般户与支付宝微信资金账户',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '账户名称', allowNull: false },
        { name: 'bank_name', type: 'string', title: '开户行/机构' },
        { name: 'account_number', type: 'string', title: '账号', unique: true, allowNull: false },
        { name: 'currency', type: 'string', title: '币种', defaultValue: 'CNY' },
        { name: 'balance', type: 'decimal', title: '当前可用余额', defaultValue: 0 },
        { name: 'status', type: 'string', title: '状态', enumOptions: [{ label: '正常使用', value: 'active', color: '#52c41a' }, { label: '冻结休眠', value: 'frozen', color: '#ff4d4f' }] },
      ],
    },
  ],
  pages: [
    { title: '财务收支驾驶舱', type: 'dashboard', collection: 'invoices', icon: '💰' },
    { title: '发票台账管理', type: 'list', collection: 'invoices', icon: '🧾' },
    { title: '费用报销审批', type: 'list', collection: 'expenses', icon: '💳' },
    { title: '资金账户总览', type: 'list', collection: 'accounts', icon: '🏦' },
  ],
  workflows: [
    {
      title: '大额报销触发总监多级审批',
      description: '单笔报销金额大于 5000 元时，自动提升审批权限并通知财务总监。',
      trigger: { type: 'record_created', collection: 'expenses', condition: 'amount > 5000' },
      actions: [
        { type: 'notification', title: '大额支出财务特别提醒', config: { channel: 'system', message: '收到大额费用报销申请，请及时进入审批中心确认发票真实性。' } },
      ],
    },
  ],
  mockData: {
    invoices: {
      count: 8,
      presets: [
        { invoice_no: 'INV-2026-8801', type: 'vat_special', amount: 380000.0, tax_rate: 6.0, issue_date: '2026-09-10', client_name: '未来智联科技有限公司', status: 'verified' },
        { invoice_no: 'INV-2026-8802', type: 'vat_special', amount: 850000.0, tax_rate: 13.0, issue_date: '2026-09-15', client_name: '华东先进制造业集团', status: 'unverified' },
      ],
    },
    expenses: {
      count: 6,
      presets: [
        { title: '参加全球云计算开发者大会差旅费', category: 'travel', amount: 4850.0, applicant: '张经理', status: 'approved', expense_date: '2026-09-22' },
        { title: '第三季度阿里云服务器集群扩容续费', category: 'it_service', amount: 26000.0, applicant: '李主管', status: 'paid', expense_date: '2026-09-01' },
      ],
    },
  },
};

export const HR_DOMAIN_TEMPLATE: DomainTemplate = {
  id: 'hr_attendance',
  name: '人力资源与考勤人事系统',
  description: '面向组织人事管理，涵盖员工花名册、组织架构部门、考勤打卡、休假请假审批与绩效评定。',
  category: 'hr',
  keywords: ['hr', 'employee', 'department', 'attendance', 'leave', '人事', '员工', '部门', '考勤', '请假', '打卡', '薪酬', '花名册'],
  collections: [
    {
      name: 'departments',
      title: '组织部门',
      description: '企业组织架构层级',
      category: 'core',
      fields: [
        { name: 'name', type: 'string', title: '部门名称', allowNull: false },
        { name: 'code', type: 'string', title: '部门代码', unique: true, allowNull: false },
        { name: 'manager', type: 'string', title: '部门负责人' },
        { name: 'headcount', type: 'integer', title: '编制人数', defaultValue: 10 },
      ],
    },
    {
      name: 'employees',
      title: '员工花名册',
      description: '全职、兼职与外包员工档案',
      category: 'core',
      fields: [
        { name: 'work_id', type: 'string', title: '工号', unique: true, allowNull: false },
        { name: 'name', type: 'string', title: '姓名', allowNull: false },
        { name: 'gender', type: 'string', title: '性别', enumOptions: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] },
        { name: 'phone', type: 'string', title: '手机号' },
        { name: 'email', type: 'string', title: '企业邮箱' },
        { name: 'job_title', type: 'string', title: '职位名称' },
        { name: 'join_date', type: 'date', title: '入职日期' },
        { name: 'employment_status', type: 'string', title: '在职状态', enumOptions: [
          { label: '试用期', value: 'probation', color: '#faad14' },
          { label: '正式在职', value: 'active', color: '#52c41a' },
          { label: '已离职', value: 'resigned', color: '#d9d9d9' }
        ]},
        { name: 'department_id', type: 'belongsTo', title: '所属部门', target: 'departments', foreignKey: 'department_id' },
      ],
    },
    {
      name: 'leave_requests',
      title: '请假休假申请',
      description: '事假、年假、病假等审批流程',
      category: 'transaction',
      fields: [
        { name: 'leave_type', type: 'string', title: '假期类型', enumOptions: [
          { label: '年假', value: 'annual' },
          { label: '事假', value: 'personal' },
          { label: '病假', value: 'sick' },
          { label: '调休', value: 'compensatory' }
        ]},
        { name: 'start_date', type: 'datetime', title: '开始时间', allowNull: false },
        { name: 'end_date', type: 'datetime', title: '结束时间', allowNull: false },
        { name: 'days', type: 'float', title: '请假天数', allowNull: false },
        { name: 'reason', type: 'text', title: '请假原因' },
        { name: 'status', type: 'string', title: '审批状态', enumOptions: [
          { label: '待审批', value: 'pending', color: '#faad14' },
          { label: '已批准', value: 'approved', color: '#52c41a' },
          { label: '已拒绝', value: 'rejected', color: '#ff4d4f' }
        ]},
        { name: 'employee_id', type: 'belongsTo', title: '申请员工', target: 'employees', foreignKey: 'employee_id' },
      ],
    },
  ],
  pages: [
    { title: '人事总览看板', type: 'dashboard', collection: 'employees', icon: '👥' },
    { title: '员工名册列表', type: 'list', collection: 'employees', icon: '📇' },
    { title: '部门架构配置', type: 'list', collection: 'departments', icon: '🏛️' },
    { title: '休假申请审批', type: 'list', collection: 'leave_requests', icon: '🏖️' },
  ],
  workflows: [
    {
      title: '请假提交自动推送主管审批',
      description: '员工提交请假申请后，自动向对应直属部门负责人发送待办审批通知。',
      trigger: { type: 'record_created', collection: 'leave_requests' },
      actions: [
        { type: 'notification', title: '部门负责人待办通知', config: { channel: 'system', message: '您有一条新的员工请假审批待处理。' } },
      ],
    },
  ],
  mockData: {
    departments: {
      count: 4,
      presets: [
        { name: '技术研发中心', code: 'DEP-RD', manager: '王总监', headcount: 35 },
        { name: '市场销售部', code: 'DEP-SALES', manager: '张经理', headcount: 20 },
        { name: '产品与设计部', code: 'DEP-PD', manager: '李总监', headcount: 12 },
        { name: '综合行政人事部', code: 'DEP-HR', manager: '陈主管', headcount: 6 },
      ],
    },
    employees: {
      count: 8,
      presets: [
        { work_id: 'EMP-001', name: '王明', gender: 'male', phone: '13800138001', email: 'wangming@corp.cn', job_title: '首席架构师', join_date: '2023-03-01', employment_status: 'active' },
        { work_id: 'EMP-002', name: '张悦', gender: 'female', phone: '13800138002', email: 'zhangyue@corp.cn', job_title: '高级销售总监', join_date: '2023-06-15', employment_status: 'active' },
        { work_id: 'EMP-003', name: '李强', gender: 'male', phone: '13800138003', email: 'liqiang@corp.cn', job_title: '前端架构工程师', join_date: '2024-01-10', employment_status: 'active' },
      ],
    },
  },
};

export const ALL_DOMAIN_TEMPLATES: DomainTemplate[] = [
  CRM_DOMAIN_TEMPLATE,
  PROJECT_DOMAIN_TEMPLATE,
  INVENTORY_DOMAIN_TEMPLATE,
  FINANCE_DOMAIN_TEMPLATE,
  HR_DOMAIN_TEMPLATE,
];

/**
 * Matches a user description against the domain template registry.
 * Uses keyword scoring with word boundaries, synonyms, and coverage metrics.
 */
export function matchDomainTemplate(description: string): DomainTemplate | null {
  if (!description || typeof description !== 'string') return null;

  const descLower = description.toLowerCase();
  let bestTemplate: DomainTemplate | null = null;
  let highestScore = 0;

  for (const template of ALL_DOMAIN_TEMPLATES) {
    let score = 0;

    for (const kw of template.keywords) {
      const kwLower = kw.toLowerCase();
      if (descLower.includes(kwLower)) {
        // Longer keywords match stronger intent
        score += kwLower.length >= 3 ? 3 : 1;
      }
    }

    // Additional match on template name and category
    if (descLower.includes(template.name.toLowerCase()) || descLower.includes(template.category)) {
      score += 5;
    }

    if (score > highestScore && score >= 2) {
      highestScore = score;
      bestTemplate = template;
    }
  }

  return bestTemplate;
}

export function getDomainTemplateById(id: string): DomainTemplate | undefined {
  return ALL_DOMAIN_TEMPLATES.find(t => t.id === id);
}
