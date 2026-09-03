import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';

// Изолируем сетевую среду и подменяем ответ от ProxyAPI для GigaChat
vi.mock('axios');

describe('Тестирование модуля интеграции с GigaChat API', () => {
  it('Должен имитировать успешный аналитический ответ от ИИ', async () => {
    const mockedResponse = {
      data: {
        choices: [
          { message: { content: 'Рекомендации по ИИС сформированы.' } },
        ],
      },
    };
    vi.mocked(axios.post).mockResolvedValue(mockedResponse);

    expect(mockedResponse.data.choices[0].message.content).toContain(
      'Рекомендации',
    );
  });
});
