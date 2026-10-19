// Carrega automaticamente `src/features/<feature>/register.ts` de TODAS as features.
// Assim cada fase registra editores/paineis sem editar App.tsx nem este arquivo.
// Chamado uma vez em main.tsx antes do primeiro render.

const modules = import.meta.glob('./*/register.ts');

export async function loadFeatureRegistrations(): Promise<void> {
  await Promise.all(Object.values(modules).map((load) => load()));
}
