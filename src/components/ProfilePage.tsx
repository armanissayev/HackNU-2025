import React, { useState } from 'react';
import { ZButton } from './ZButton';
import { ZInput } from './ZInput';
import { ZCard } from './ZCard';
import { User, Mail, Phone, MapPin, Edit2 } from 'lucide-react';

interface ProfilePageProps {
  onNavigate: (page: string) => void;
}

export function ProfilePage({ onNavigate }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState({
    name: 'Alex Johnson',
    email: 'alex.johnson@example.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA'
  });

  const [tempProfile, setTempProfile] = useState(profile);

  const handleSave = () => {
    setProfile(tempProfile);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempProfile(profile);
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-[#E9F2EF] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-[#0B1F1A]" style={{ fontSize: '32px', fontWeight: 700 }}>
            Профиль
          </h1>
          <ZButton variant="secondary" onClick={() => onNavigate('chat')}>
            Назад к чату
          </ZButton>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ZCard className="md:col-span-1 flex flex-col items-center">
            <div className="w-32 h-32 bg-gradient-to-br from-[#2D9A86] to-[#1A5C50] rounded-full flex items-center justify-center mb-4">
              <User className="w-16 h-16 text-white" />
            </div>
            <h2 className="text-[#0B1F1A] mb-1" style={{ fontSize: '24px', fontWeight: 700 }}>
              {profile.name}
            </h2>
            <p className="text-[#475B53]" style={{ fontSize: '14px' }}>
              С нами с октября 2025
            </p>
            <div className="mt-6 w-full">
              <ZButton 
                variant="primary" 
                className="w-full mb-3"
                onClick={() => setIsEditing(!isEditing)}
              >
                <Edit2 className="w-4 h-4 inline mr-2" />
                {isEditing ? 'Отменить' : 'Редактировать профиль'}
              </ZButton>
              <ZButton 
                variant="accent" 
                className="w-full"
                onClick={() => onNavigate('analysis')}
              >
                Открыть аналитику
              </ZButton>
            </div>
          </ZCard>

          <ZCard className="md:col-span-2">
            <h2 className="text-[#0B1F1A] mb-6" style={{ fontSize: '24px', fontWeight: 700 }}>
              Личная информация
            </h2>

            {!isEditing ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-[#E9F2EF] rounded-xl">
                  <User className="w-5 h-5 text-[#2D9A86]" />
                  <div>
                    <p className="text-[#475B53]" style={{ fontSize: '14px' }}>Full Name</p>
                    <p className="text-[#0B1F1A]" style={{ fontSize: '16px' }}>{profile.name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-[#E9F2EF] rounded-xl">
                  <Mail className="w-5 h-5 text-[#2D9A86]" />
                  <div>
                    <p className="text-[#475B53]" style={{ fontSize: '14px' }}>Email</p>
                    <p className="text-[#0B1F1A]" style={{ fontSize: '16px' }}>{profile.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-[#E9F2EF] rounded-xl">
                  <Phone className="w-5 h-5 text-[#2D9A86]" />
                  <div>
                    <p className="text-[#475B53]" style={{ fontSize: '14px' }}>Phone</p>
                    <p className="text-[#0B1F1A]" style={{ fontSize: '16px' }}>{profile.phone}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-[#E9F2EF] rounded-xl">
                  <MapPin className="w-5 h-5 text-[#2D9A86]" />
                  <div>
                    <p className="text-[#475B53]" style={{ fontSize: '14px' }}>Location</p>
                    <p className="text-[#0B1F1A]" style={{ fontSize: '16px' }}>{profile.location}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <ZInput
                  label="Full Name"
                  value={tempProfile.name}
                  onChange={(e) => setTempProfile({ ...tempProfile, name: e.target.value })}
                />
                <ZInput
                  label="Email"
                  type="email"
                  value={tempProfile.email}
                  onChange={(e) => setTempProfile({ ...tempProfile, email: e.target.value })}
                />
                <ZInput
                  label="Phone"
                  value={tempProfile.phone}
                  onChange={(e) => setTempProfile({ ...tempProfile, phone: e.target.value })}
                />
                <ZInput
                  label="Location"
                  value={tempProfile.location}
                  onChange={(e) => setTempProfile({ ...tempProfile, location: e.target.value })}
                />
                <div className="flex gap-3 pt-4">
                  <ZButton variant="primary" onClick={handleSave} className="flex-1">
                    Save Changes
                  </ZButton>
                  <ZButton variant="secondary" onClick={handleCancel} className="flex-1">
                    Cancel
                  </ZButton>
                </div>
              </div>
            )}
          </ZCard>
        </div>
      </div>
    </div>
  );
}
