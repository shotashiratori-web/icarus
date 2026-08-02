// Unit E-1のZukanFieldDetailScreenで定義した検証をUnit F-3の一括写真整理画面と共有するため切り出し。
export function validateFoodName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '食材名は必須です';
  if (trimmed === '無題') return '「無題」は食材名として保存できません';
  return '';
}
