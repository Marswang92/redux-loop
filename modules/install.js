import { throwInvariant } from './utils'
import { loop, getCmd, getModel, isLoop, liftState } from './loop'
import Cmd, { cmdToPromise, isCmd } from './cmd'
import { loopPromiseCaughtError } from './errors'


const noCmdPromise = Promise.resolve()


export function install() {
  return (next) => (reducer, initialState, enhancer) => {
    const [initialModel, initialCmd] = liftState(initialState)
    let cmdsQueue = []

    const liftReducer = (reducer) => (state, action) => {
      const result = reducer(state, action)
      const [model, cmd] = liftState(result)
      cmdsQueue.push(cmd)
      return model
    }

    const store = next(liftReducer(reducer), initialModel, enhancer)

    const runCmds = (queue, originalActions) => {
      const promises = queue.map((cmd) => runCmd({ originalActions, cmd })).filter((x) => x)
      if (promises.length === 0) {
        return Promise.resolve()
      } else if (promises.length === 1) {
        return promises[0]
      } else {
        return Promise.all(promises).then(() => {})
      }
    }

    const runCmd = ({ originalActions, cmd }) => {
      const cmdPromise = cmdToPromise(cmd, dispatch, store.getState)

      if (!cmdPromise) return null

      return cmdPromise
        .then((actions) => {
          if (!actions.length) return
          return Promise.all(actions.map((action) => dispatch(action, originalActions)))
        })
        .catch((error) => {
          console.error(loopPromiseCaughtError(originalActions.map(x => x.type).concat('>>'), error))
          throw error
        })
    }

    const dispatch = (action, originalActions = []) => {
      store.dispatch(action, originalActions)
      const cmdsToRun = cmdsQueue
      cmdsQueue = []
      return runCmds(cmdsToRun, originalActions.concat(action))
    }

    const replaceReducer = (reducer) => {
      return store.replaceReducer(liftReducer(reducer))
    }

    runCmd({
      originalActions: [ { type: '@@ReduxLoop/INIT' } ],
      cmd: initialCmd
    })

    return {
      ...store,
      dispatch,
      replaceReducer,
    }
  }
}
