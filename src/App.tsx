import React, { useState } from 'react';
import { ProfilePage } from './components/ProfilePage';
import { ChatPage } from './components/ChatPage';
import { AnalysisPage } from './components/AnalysisPage';

type Page = 'chat' | 'profile' | 'analysis';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');

  const handleNavigate = (page: string) => {
    setCurrentPage(page as Page);
  };

  return (
    <>
      {currentPage === 'chat' && <ChatPage onNavigate={handleNavigate} />}
      {currentPage === 'profile' && <ProfilePage onNavigate={handleNavigate} />}
      {currentPage === 'analysis' && <AnalysisPage onNavigate={handleNavigate} />}
    </>
  );
}
