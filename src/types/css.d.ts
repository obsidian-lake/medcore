// Allow CSS module imports (resolved by consuming app's Vite bundler).
declare module '*.css' {
  const styles: Record<string, string>
  export default styles
}
