import { ref } from 'vue';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export const confirmState = ref({
  visible: false,
  options: {} as ConfirmOptions,
  resolve: (value: boolean) => {},
});

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = {
      visible: true,
      options,
      resolve,
    };
  });
}

export function closeConfirm(result: boolean) {
  confirmState.value.visible = false;
  if (confirmState.value.resolve) {
    confirmState.value.resolve(result);
  }
}
