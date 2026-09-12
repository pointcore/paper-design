import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  ElButton,
  ElCheckbox,
  ElColorPicker,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSlider,
  ElSwitch,
  ElTag,
  ElTooltip,
} from 'element-plus'
import 'element-plus/es/components/base/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/checkbox/style/css'
import 'element-plus/es/components/color-picker/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/dropdown-item/style/css'
import 'element-plus/es/components/dropdown-menu/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/radio-button/style/css'
import 'element-plus/es/components/radio-group/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/slider/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/tag/style/css'
import 'element-plus/es/components/tooltip/style/css'
import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Register only the components the editor actually renders — pulling in the
// whole library through app.use(ElementPlus) cost hundreds of KB of the
// initial chunk for widgets that never appear.
const components = {
  'el-button': ElButton,
  'el-checkbox': ElCheckbox,
  'el-color-picker': ElColorPicker,
  'el-dialog': ElDialog,
  'el-dropdown': ElDropdown,
  'el-dropdown-item': ElDropdownItem,
  'el-dropdown-menu': ElDropdownMenu,
  'el-icon': ElIcon,
  'el-input': ElInput,
  'el-input-number': ElInputNumber,
  'el-option': ElOption,
  'el-radio-button': ElRadioButton,
  'el-radio-group': ElRadioGroup,
  'el-select': ElSelect,
  'el-slider': ElSlider,
  'el-switch': ElSwitch,
  'el-tag': ElTag,
  'el-tooltip': ElTooltip,
} as const
for (const [name, comp] of Object.entries(components)) {
  app.component(name, comp as Parameters<typeof app.component>[1])
}

app.mount('#app')
