import React, { useState } from 'react';
import { ZButton } from './ZButton';
import { ZInput } from './ZInput';
import { ZCard } from './ZCard';

interface LoginPageProps {
  onLogin: (email: string, password: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center p-4">
      <ZCard className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-[#0B1F1A] mb-2" style={{ fontSize: '32px', fontWeight: 700 }}>
            {isLogin ? 'С возвращением' : 'Создать аккаунт'}
          </h1>
          <p className="text-[#475B53]" style={{ fontSize: '16px' }}>
            {isLogin ? 'Войдите, чтобы продолжить' : 'Зарегистрируйтесь, чтобы начать'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <ZInput
              label="Полное имя"
              type="text"
              placeholder="Введите ваше имя"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          
          <ZInput
            label="Электронная почта"
            type="email"
            placeholder="Введите вашу почту"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          
          <ZInput
            label="Пароль"
            type="password"
            placeholder="Введите пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText={isLogin ? '' : 'Не менее 8 символов'}
            required
          />

          <div className="pt-4 space-y-3">
            <ZButton variant="primary" type="submit" className="w-full">
              {isLogin ? 'Войти' : 'Зарегистрироваться'}
            </ZButton>
            
            <ZButton
              variant="secondary"
              type="button"
              className="w-full"
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? 'Создать новый аккаунт' : 'Уже есть аккаунт?'}
            </ZButton>
          </div>
        </form>

        {isLogin && (
          <div className="mt-4 text-center">
            <button className="text-[#2D9A86] hover:underline" style={{ fontSize: '14px' }}>
              Забыли пароль?
            </button>
          </div>
        )}
      </ZCard>
    </div>
  );
}
