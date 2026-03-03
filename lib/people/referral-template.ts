const CONNECTION_FIRST_NAME_PLACEHOLDER = "{{connection_first_name}}";

function normalizeName(firstName: string | null | undefined): string {
  const value = (firstName || "").trim();
  return value.length > 0 ? value : "there";
}

export function applyConnectionPlaceholder(template: string, firstName: string | null | undefined): string {
  const safeName = normalizeName(firstName);
  if (template.includes(CONNECTION_FIRST_NAME_PLACEHOLDER)) {
    return template.split(CONNECTION_FIRST_NAME_PLACEHOLDER).join(safeName);
  }

  return `Hi ${safeName},\n\n${template}`;
}

export { CONNECTION_FIRST_NAME_PLACEHOLDER };
