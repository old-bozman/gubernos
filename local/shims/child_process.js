// node:child_process for the iOS offline mode: nothing can be spawned on the phone.
const no = () => { throw Object.assign(new Error('not available on the phone'), { code: 'ENOTSUP' }); };
export const execFileSync = no, execFile = no, spawn = no, execSync = no;
export default { execFileSync, execFile, spawn, execSync };
