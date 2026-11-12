import StartExePage from './StartExePage.vue'

export default {
  name: 'la-start-exe',
  inject: ['navigation'],
  apply(ctx) {
    ctx.navigation.register({
      id: 'la-start-exe',
      label: '启动台',
      icon: 'Promotion',
      order: 25,
      component: StartExePage,
    })
  }
}
